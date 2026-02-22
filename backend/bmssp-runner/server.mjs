import readline from "node:readline";
import { buildGraph, sssp } from "bm-sssp";

// A tiny stdin/stdout JSONL 'RPC' server.
// Python sends one JSON object per line. We respond with one JSON object per line.
// Keeping this process alive avoids Node startup + module import overhead on every request.

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

function safeWrite(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch (e) {
    // Last-ditch: avoid crashing the process.
    process.stdout.write(JSON.stringify({ error: String(e) }) + "\n");
  }
}

rl.on("line", (line) => {
  const trimmed = (line || "").trim();
  if (!trimmed) return;

  try {
    const input = JSON.parse(trimmed);
    const { n, edges, source, target, returnPredecessors = true } = input;

    const graph = buildGraph({ numberOfNodes: n, edgeList: edges });
    const { distance, predecessor } = sssp(graph, { source, target, returnPredecessors });

    safeWrite({
      distances: distance,
      predecessors: predecessor,
    });
  } catch (err) {
    safeWrite({ error: String(err) });
  }
});

rl.on("close", () => {
  process.exit(0);
});
