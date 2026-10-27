// a worker under a trusted types csp that makes its own relative request
onmessage = () => fetch('data.txt').then((r) => r.text()).then((t) => postMessage('from-worker ' + t.trim()), (e) => postMessage('fail ' + e.message));
