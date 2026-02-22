import requests


def main() -> None:
    base = "http://127.0.0.1:8000"
    params = {
        "from_lat": 38.9072,
        "from_lng": -77.0369,
        "to_lat": 40.7128,
        "to_lng": -74.0060,
        "traffic": 1,
    }
    res = requests.get(f"{base}/", timeout=10)
    print("Backend up:", res.status_code)

    route = requests.post(f"{base}/api/algo/calculate", json={
        "start": {"lat": params["from_lat"], "lng": params["from_lng"]},
        "end": {"lat": params["to_lat"], "lng": params["to_lng"]},
        "scenario_type": "ROUTINE",
        "algorithm": "google",
        "include_exploration": False,
        "blocked_edges": None,
    }, timeout=20)
    print("Route status:", route.status_code)
    print(route.json())


if __name__ == "__main__":
    main()
