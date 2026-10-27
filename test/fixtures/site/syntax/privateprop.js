// debugger ;$0.textContent = __proc$Script(`(e,t,n)=>{
//     var u = class {
//         #o;
//         a(e) {
//             this.#o.queries = 1;
//         }
//     }
// }`)

var u = class {
  #o;
  constructor() {
    this.#o = {queries: 123};
  }
  test() {
      return this.#o.queries
  }
};
var instance = new u;
if (instance.test() !== 123) {
  console.log('Test failed. See variables u and instance');
}

console.log('Done');