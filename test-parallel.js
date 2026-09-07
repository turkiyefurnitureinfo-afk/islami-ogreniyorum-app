async function test() {
  // Simulate slow Gemini (15s timeout) + fast Wikipedia (3s)
  // Use the "firstValid" pattern (same as ai-answer.js) so a fast
  // search result is returned as soon as it's available — we don't
  // wait for the slow Gemini promise to settle.
  const searchPromise = new Promise(r => setTimeout(() => r({answer: "search result", provider: "google-search"}), 3000));
  const geminiPromise = new Promise(r => setTimeout(() => r(null), 15000));

  const firstValid = (promises) => new Promise((resolve) => {
    let pending = promises.length;
    for (const p of promises) {
      p.then((result) => {
        if (result) {
          resolve(result);
        } else {
          pending -= 1;
          if (pending === 0) resolve(null);
        }
      }).catch(() => {
        pending -= 1;
        if (pending === 0) resolve(null);
      });
    }
  });

  const result = await firstValid([geminiPromise, searchPromise]);
  if (result) return result;
  return null;
}
console.log(JSON.stringify(await test()));