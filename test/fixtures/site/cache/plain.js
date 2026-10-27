// a script with nothing session specific, so every user can share its rewritten output
window.cacheFixture = { value: window.location.href, sum: [1, 2, 3].reduce((a, b) => a + b) };
