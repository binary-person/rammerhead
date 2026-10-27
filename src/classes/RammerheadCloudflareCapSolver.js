const https = require('https');
const streamToString = require("../util/streamToString.js");
const RammerheadCloudflareGenericSolver = require("./RammerheadCloudflareGenericSolver.js");
const parseUrl = require('url').parse;

class RammerheadCloudflareCapSolver extends RammerheadCloudflareGenericSolver {
  /**
   * 
   * @param {{capSolverAPIKey: string} & import("./RammerheadCloudflareGenericSolver.js").RammerheadCloudflareGenericSolverArguments} options
   */
  constructor({
    capSolverAPIKey,
    disableProxy = true,
    ...options
  }) {
    options.disableProxy = disableProxy;
    super(options);

    if (!capSolverAPIKey) {
      throw new TypeError('capSolverAPIKey must be specified');
    }
    // if (options.disableProxy) {
    //   throw new TypeError('must enable proxy');
    // }

    this.capSolverAPIKey = capSolverAPIKey;

    this.initialRun();
  }

  async initialRun() {
    // check balance and log it
    this.logger.info(`(CapSolver.initialRun) Current balance: $${(await this.getBalance()).balance}`);
  }

  async cfSolver({ url, siteurl = null, sitekey, data, pagedata, action, userAgent }) {
    if (!url) {
      throw new TypeError('url must be specified');
    }

    this.logger.debug('(CapSolver.cfSolver) initiate solving for ' + url);

    const taskId = (await this.createCFChallengeTask(url, sitekey, action)).taskId;
    this.logger.debug(`(CapSolver.cfSolver) got taskId ${taskId} for url ${url}`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const result = await this.getTaskResult(taskId);
      this.logger.debug(`(CapSolver.cfSolver) status for taskId ${taskId}: ${result.status}`);
      if (result.status !== 'ready') {
        if (result.status === 'idle') {
          // console.log(result);
          throw new Error('unhandled idle state for taskId ' + taskId);
        } else if (result.status !== 'processing') {
          // console.log(result);
          throw new Error('unhandled unknown state for taskId ' + taskId + ': ' + result.status);
        }
      } else {
        this.logger.debug('(CapSolver.cfSolver) got solution for ' + url);
        return { cookie: result.solution.token, userAgent: result.solution.userAgent };
      }
    }
  }

  ///// capsolver apis /////

  /**
   * 
   * @returns {Promise<{ balance: number, errorId: 0, packages: string[] }>}
   */
  async getBalance() {
    return await request('https://api.capsolver.com/getBalance', 'POST', {
      "clientKey": this.capSolverAPIKey
    });
  }

  /**
   * 
   * @param {string} site 
   * @returns {Promise<{ errorId: 0, status: 'idle', taskId: string }>}
   */
  async createCFChallengeTask(site, sitekey, action) {
    if (!site) {
      throw new TypeError('site must be specified');
    }
    return await request('https://api.capsolver.com/createTask', 'POST', {
      "clientKey": this.capSolverAPIKey,
      "task": {
        "type": "AntiTurnstileTaskProxyLess",
        "websiteURL": site,
        "websiteKey": sitekey
        // "type": "AntiTurnstileTaskProxyLess",
        // "websiteURL": site,
        // "proxy": `socks5:${this.publicProxyAddress}:${this.publicProxyPort}:${this.proxyUsername}:${this.proxyPassword}`
      }
    });
  }

  /**
   * 
   * @param {string} taskId 
   * @returns { Promise<{ errorId: 0, errorCode: null, errorDescription: null, solution: { token: string, type: 'challenge', userAgent: string }, status: 'idle' | 'processing' | 'ready' }> }
   */
  async getTaskResult(taskId) {
    if (!taskId) {
      throw new TypeError('taskId must be specified');
    }
    return await request('https://api.capsolver.com/getTaskResult', 'POST', {
      "clientKey": this.capSolverAPIKey,
      "taskId": taskId
    });
  }
}

function request(url, method, body) {
  console.log(url, method, body);
  return new Promise((resolve, reject) => {
    https.request({
      ...parseUrl(url),
      method
    }, async res => {
      const json = JSON.parse(await streamToString(res));
      if (json.errorCode) {
        console.log(json);
        reject(`unexpected error response from capsolver. ${json.errorCode} - ${json.errorDescription}`);
      }
      resolve(json);
    }).end(typeof body === 'object' && body !== null ? JSON.stringify(body) : body);
  });
}

module.exports = RammerheadCloudflareCapSolver;
