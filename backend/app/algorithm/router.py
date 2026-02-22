import subprocess
import threading
import time
from functools import lru_cache
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.google_places import autocomplete_places
from app.services.google_routes import compute_route

router = APIRouter()


class GeocodeResponse(BaseModel):
    lat: float
    lng: float
    display_name: str


class AutocompleteResult(BaseModel):
    lat: float
    lng: float
    display_name: str
    place_id: Optional[str] = None


class AutocompleteResponse(BaseModel):
    results: List[AutocompleteResult]


class Coordinate(BaseModel):
    lat: float
    lng: float


class RouteRequest(BaseModel):
    start: Coordinate
    end: Coordinate
    scenario_type: str = "ROUTINE"
    algorithm: str = "google"
    blocked_edges: Optional[List[List[float]]] = None
    include_exploration: bool = False


class PivotNode(BaseModel):
    id: str
    lat: float
    lng: float
    type: str


class NavStep(BaseModel):
    id: int
    instruction: str
    street: str
    start_distance_m: float
    end_distance_m: float
    maneuver: str


class RouteResponse(BaseModel):
    algorithm: str
    destination: str
    execution_time_ms: float
    algorithm_time_ms: Optional[float] = None
    total_time_ms: Optional[float] = None
    pivots_identified: List[PivotNode]
    path_coordinates: List[List[float]]  # [lng, lat]
    snapped_start: List[float]
    snapped_end: List[float]
    total_distance_m: float
    total_time_s: float
    cum_distance_m: List[float]
    cum_time_s: List[float]
    steps: List[NavStep]
    narrative: List[str]
    explored_coords: Optional[List[List[List[float]]]] = None
    explored_count: Optional[int] = None
    network_edges_coords: Optional[List[List[List[float]]]] = None


AIR_SPEED_MPS = 250.0  # ~900 km/h


def _haversine_m(a: Coordinate, b: Coordinate) -> float:
    import math

    r = 6371000.0
    dlat = math.radians(b.lat - a.lat)
    dlng = math.radians(b.lng - a.lng)
    lat1 = math.radians(a.lat)
    lat2 = math.radians(b.lat)
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _interpolate_air_path(start: Coordinate, end: Coordinate, points: int = 128) -> List[Coordinate]:
    if points < 2:
        return [start, end]
    coords: List[Coordinate] = []
    for i in range(points):
        t = i / (points - 1)
        coords.append(
            Coordinate(
                lat=start.lat + (end.lat - start.lat) * t,
                lng=start.lng + (end.lng - start.lng) * t,
            )
        )
    return coords


def _remove_blocked_edges(G: nx.MultiDiGraph, blocked_points: List[List[float]], radius_m: float = 100.0) -> nx.MultiDiGraph:
    """Return a copy of G with edges near blocked_points removed.
    Only considers edges that touch nodes within radius of a block (faster than scanning all edges)."""
    if not blocked_points:
        return G
    # 1) Nodes within radius of any blocked point (candidate edges touch these)
    bp_coords = [Coordinate(lat=blat, lng=blng) for blat, blng in blocked_points]
    nearby_nodes = set()
    for node, data in G.nodes(data=True):
        x, y = data.get("x"), data.get("y")
        if x is None or y is None:
            continue
        pt = Coordinate(lat=float(y), lng=float(x))
        for bp in bp_coords:
            if _haversine_m(bp, pt) < radius_m:
                nearby_nodes.add(node)
                break
    # 2) Only check edges incident to those nodes (avoids haversine on most of the graph)
    edges_to_remove = set()
    for u, v, k in list(G.edges(keys=True)):
        if u not in nearby_nodes and v not in nearby_nodes:
            continue
        u_lng, u_lat = G.nodes[u]["x"], G.nodes[u]["y"]
        v_lng, v_lat = G.nodes[v]["x"], G.nodes[v]["y"]
        mid_lng = (u_lng + v_lng) / 2.0
        mid_lat = (u_lat + v_lat) / 2.0
        u_pt = Coordinate(lat=float(u_lat), lng=float(u_lng))
        v_pt = Coordinate(lat=float(v_lat), lng=float(v_lng))
        mid_pt = Coordinate(lat=mid_lat, lng=mid_lng)
        for bp in bp_coords:
            if (_haversine_m(bp, u_pt) < radius_m or
                _haversine_m(bp, mid_pt) < radius_m or
                _haversine_m(bp, v_pt) < radius_m):
                edges_to_remove.add((u, v, k))
                break
    G2 = G.copy()
    for u, v, k in edges_to_remove:
        if G2.has_edge(u, v, k):
            G2.remove_edge(u, v, k)
    return G2


def _bbox_for_route(start: Coordinate, end: Coordinate, pad_deg: float = 0.02):
    north = max(start.lat, end.lat) + pad_deg
    south = min(start.lat, end.lat) - pad_deg
    east = max(start.lng, end.lng) + pad_deg
    west = min(start.lng, end.lng) - pad_deg
    return north, south, east, west


def _round_bbox(north: float, south: float, east: float, west: float, digits: int = 3):
    return (round(north, digits), round(south, digits), round(east, digits), round(west, digits))


@lru_cache(maxsize=16)
def _load_graph_cached(north: float, south: float, east: float, west: float) -> nx.MultiDiGraph:
    """Load a drive network for the bbox (cached)."""
    bbox = (west, south, east, north)  # (left, bottom, right, top) for OSMnx v2
    G = ox.graph_from_bbox(bbox, network_type="drive", simplify=True)
    return G


# -----------------------------------------------
# Precomputed MSH shortest-path tree (reverse Dijkstra)
# -----------------------------------------------
import heapq as _heapq

# Module-level cache: {(north, south, east, west): (msh_node, predecessors, distances)}
_msh_spt_cache: Dict[tuple, Tuple[int, Dict[int, Optional[int]], Dict[int, float]]] = {}


def _is_msh_destination(end: 'Coordinate') -> bool:
    """Check if the destination coordinates match MSH within threshold."""
    return (abs(end.lat - MSH_LAT) < _MSH_MATCH_THRESHOLD_DEG and
            abs(end.lng - MSH_LNG) < _MSH_MATCH_THRESHOLD_DEG)


def _get_msh_shortest_path_tree(
    G: nx.MultiDiGraph, bbox_key: tuple
) -> Tuple[int, Dict[int, Optional[int]], Dict[int, float]]:
    """Return (msh_node, predecessors, distances) using a reverse Dijkstra from MSH.

    'Reverse' means we run Dijkstra on the reversed graph so that
    predecessors[node] gives the *next* node on the path FROM node TO msh_node.
    This lets any source instantly reconstruct its path to MSH.
    """
    if bbox_key in _msh_spt_cache:
        return _msh_spt_cache[bbox_key]

    print(f"[MSH-CACHE] Building shortest-path tree for MSH (first call)...")
    build_start = time.time()

    msh_node = ox.nearest_nodes(G, X=MSH_LNG, Y=MSH_LAT)

    # Reverse the graph: an edge u->v becomes v->u so that Dijkstra from MSH
    # computes shortest paths from ALL nodes TO MSH.
    R = G.reverse(copy=False)

    dist: Dict[int, float] = {msh_node: 0.0}
    pred: Dict[int, Optional[int]] = {msh_node: None}
    visited: set = set()
    heap = [(0.0, msh_node)]

    while heap:
        d, u = _heapq.heappop(heap)
        if u in visited:
            continue
        visited.add(u)
        for v, edge_dict in R[u].items():
            if v in visited:
                continue
            best_key = min(edge_dict.keys(), key=lambda kk: float(edge_dict[kk].get("length", 1e18)))
            w = float(edge_dict[best_key].get("length", 1.0))
            new_dist = d + w
            if v not in dist or new_dist < dist[v]:
                dist[v] = new_dist
                pred[v] = u
                _heapq.heappush(heap, (new_dist, v))

    elapsed = (time.time() - build_start) * 1000
    print(f"[MSH-CACHE] Tree built: {len(visited)} nodes reachable in {elapsed:.1f}ms")

    _msh_spt_cache[bbox_key] = (msh_node, pred, dist)
    return msh_node, pred, dist


def _reconstruct_from_msh_cache(
    pred: Dict[int, Optional[int]], source_node: int, msh_node: int
) -> List[int]:
    """Reconstruct path from source_node to msh_node using precomputed predecessors."""
    path = [source_node]
    cur = source_node
    seen = {cur}
    while cur != msh_node:
        nxt = pred.get(cur)
        if nxt is None:
            raise RuntimeError(f"No precomputed path from node {source_node} to MSH")
        if nxt in seen:
            raise RuntimeError("Cycle detected in precomputed path")
        seen.add(nxt)
        path.append(nxt)
        cur = nxt
    return path


def _edge_list_from_graph(G: nx.MultiDiGraph):
    nodes = list(G.nodes)
    idx = {n: i for i, n in enumerate(nodes)}
    edges: List[List[float]] = []
    for u, v, k, data in G.edges(keys=True, data=True):
        w = float(data.get("length", 1.0))
        edges.append([idx[u], idx[v], w])
    return nodes, idx, edges


def _dijkstra_with_exploration(G: nx.MultiDiGraph, source_node: int, target_node: int) -> Tuple[List[int], List[List[List[float]]]]:
    """Custom Dijkstra that returns (path_nodes, explored_edges).
    explored_edges = list of [[lng1,lat1],[lng2,lat2]] segments in visitation order.
    """
    import heapq
    dist = {source_node: 0.0}
    pred = {source_node: None}
    visited = set()
    heap = [(0.0, source_node)]
    explored_edges: List[List[List[float]]] = []

    while heap:
        d, u = heapq.heappop(heap)
        if u in visited:
            continue
        visited.add(u)
        if u == target_node:
            break
        for v, edge_dict in G[u].items():
            if v in visited:
                continue
            # pick shortest parallel edge
            best_key = min(edge_dict.keys(), key=lambda kk: float(edge_dict[kk].get("length", 1e18)))
            w = float(edge_dict[best_key].get("length", 1.0))
            new_dist = d + w
            if v not in dist or new_dist < dist[v]:
                dist[v] = new_dist
                pred[v] = u
                heapq.heappush(heap, (new_dist, v))
            # Record this explored edge as a coordinate segment
            try:
                ux, uy = float(G.nodes[u]["x"]), float(G.nodes[u]["y"])
                vx, vy = float(G.nodes[v]["x"]), float(G.nodes[v]["y"])
                explored_edges.append([[ux, uy], [vx, vy]])
            except (KeyError, TypeError):
                pass

    # Reconstruct path
    if target_node not in pred:
        raise RuntimeError("no path found via dijkstra")
    path = []
    cur = target_node
    while cur is not None:
        path.append(cur)
        cur = pred[cur]
    path.reverse()
    return path, explored_edges

# -------------------------------
# BM-SSSP runner (Node)
# -------------------------------

_BMSSSP_RUNNER: Optional["_BmSsspServerRunner"] = None
_BMSSSP_RUNNER_INIT_LOCK = threading.Lock()


def _readline_with_timeout(pipe, timeout_s: float) -> str:
    out: List[str] = []
    def _target():
        try:
            out.append(pipe.readline())
        except Exception:
            out.append("")

    t = threading.Thread(target=_target, daemon=True)
    t.start()
    t.join(timeout_s)
    if not out:
        raise TimeoutError("bmsssp runner timed out")
    return out[0]


class _BmSsspServerRunner:
    """Keeps a single Node process alive and sends newline-delimited JSON requests.

    This removes per-call Node startup + module import overhead, which otherwise dwarfs
    the algo time for small-ish route graphs.
    """

    def __init__(self, server_path: str):
        self.server_path = server_path
        self.proc = subprocess.Popen(
            ["node", self.server_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )


def _build_cum_dist(coords: List[Coordinate]) -> List[float]:
    cum = [0.0]
    for i in range(1, len(coords)):
        cum.append(cum[-1] + _haversine_m(coords[i - 1], coords[i]))
    return cum


@router.get("/geocode", response_model=GeocodeResponse)
async def geocode(q: str = Query(..., min_length=3)):
    results = await autocomplete_places(q)
    if not results:
        raise HTTPException(status_code=400, detail="No results found.")
    top = results[0]
    return GeocodeResponse(lat=top["lat"], lng=top["lng"], display_name=top["display_name"])


@router.get("/autocomplete", response_model=AutocompleteResponse)
async def autocomplete(q: str = Query(..., min_length=3)):
    results = await autocomplete_places(q)
    return AutocompleteResponse(results=[AutocompleteResult(**r) for r in results])


@router.post("/calculate", response_model=RouteResponse)
async def calculate(req: RouteRequest):
    try:
        started = time.perf_counter()
        coords: List[Coordinate] = []
        total_distance = 0.0
        total_time = 0.0
        steps: List[NavStep] = []

        if req.algorithm == "air":
            coords = _interpolate_air_path(req.start, req.end)
            cum_distance = _build_cum_dist(coords)
            total_distance = cum_distance[-1] if cum_distance else 0.0
            total_time = max(1.0, total_distance / AIR_SPEED_MPS) if total_distance > 0 else 0.0
            steps = [
                NavStep(
                    id=0,
                    instruction="Fly to destination",
                    street="Air corridor",
                    start_distance_m=0.0,
                    end_distance_m=total_distance,
                    maneuver="depart",
                )
            ]
        else:
            route = await compute_route(req.start.lat, req.start.lng, req.end.lat, req.end.lng, traffic=True)
            if not route["path_coordinates"]:
                raise HTTPException(status_code=400, detail="No route returned.")
            coords = [Coordinate(lat=p["lat"], lng=p["lng"]) for p in route["path_coordinates"]]
            total_distance = route["total_distance_m"] or 0.0
            total_time = route["total_time_s"] or 0.0
            cursor = 0.0
            for idx, step in enumerate(route["steps"]):
                dist = float(step.get("distance_m") or 0.0)
                instruction = step.get("instruction") or "Proceed"
                steps.append(
                    NavStep(
                        id=idx,
                        instruction=instruction,
                        street=instruction,
                        start_distance_m=cursor,
                        end_distance_m=cursor + dist,
                        maneuver="depart" if idx == 0 else "drive",
                    )
                )
                cursor += dist

        algo_time_ms = (time.perf_counter() - started) * 1000

        path_coordinates = [[p.lng, p.lat] for p in coords]
        cum_distance = _build_cum_dist(coords)
        if total_distance > 0 and total_time > 0:
            cum_time = [d / total_distance * total_time for d in cum_distance]
        else:
            cum_time = [0.0 for _ in cum_distance]

        return RouteResponse(
            algorithm="air-direct" if req.algorithm == "air" else "google-routes",
            destination="",
            execution_time_ms=algo_time_ms,
            algorithm_time_ms=algo_time_ms,
            total_time_ms=algo_time_ms,
            pivots_identified=[],
            path_coordinates=path_coordinates,
            snapped_start=[path_coordinates[0][0], path_coordinates[0][1]],
            snapped_end=[path_coordinates[-1][0], path_coordinates[-1][1]],
            total_distance_m=total_distance,
            total_time_s=total_time,
            cum_distance_m=cum_distance,
            cum_time_s=cum_time,
            steps=steps,
            narrative=["Google Routes API"],
            explored_coords=[],
            explored_count=0,
            network_edges_coords=[],
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
