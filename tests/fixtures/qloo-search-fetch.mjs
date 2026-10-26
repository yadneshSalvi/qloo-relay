/** Installed-CLI contract test only. This replaces fetch and never reaches a network. */
let calls = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (++calls !== 1 || url.origin !== "https://hackathon.api.qloo.com" || url.pathname !== "/search") throw new Error("Unexpected synthetic harness request");
  const observed = { path: url.pathname, query: url.searchParams.get("query"), types: url.searchParams.get("types"), take: url.searchParams.get("take"), redirects: init?.redirect };
  process.stderr.write(`RELAY_TEST_FETCH ${JSON.stringify(observed)}\n`);
  return new Response(JSON.stringify({ results: [{ entity_id: "00000000-0000-4000-8000-000000000001", name: "Synthetic harness contract", types: [observed.types], disambiguation: "Generated test fixture" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
};
