import https from 'node:https';
import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { appendFileSync } from 'node:fs';
dns.lookup = async () => [{ address: '8.8.8.8', family: 4 }];
let count = 0;
https.request = (url, options, callback) => {
  const req = new EventEmitter();
  req.write = body => { appendFileSync(process.env.BEAD_MOCK_LOG, JSON.stringify({ path: url.pathname, body: JSON.parse(body) }) + '\n'); };
  req.end = () => {
    options.lookup(url.hostname, { all: true }, (error, addresses) => {
      if (error || !Array.isArray(addresses) || addresses[0]?.address !== '8.8.8.8') {
        req.emit('error', new Error('lookup did not return pinned addresses'));
        return;
      }
      options.lookup(url.hostname, { all: false }, (singleError, address, family) => {
        if (singleError || address !== '8.8.8.8' || family !== 4) {
          req.emit('error', new Error('lookup did not return pinned address'));
          return;
        }
        count++;
        const response = Readable.from([Buffer.from(JSON.stringify(count === 2 ? { error: {} } : { data: [{ b64_json: 'iVBORw0KGgo=' }] }))]);
        response.statusCode = count === 2 ? 404 : 200;
        queueMicrotask(() => callback(response));
      });
    });
  };
  req.destroy = () => {};
  return req;
};
