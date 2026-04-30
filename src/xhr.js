/* eslint-env browser */
import Promise from './Promise.js';
import {RequestError, StatusCodeError} from './errors.js';

function buildUrl (options) {
  const uri = options.url || options.uri || '';
  let fullUrl;
  if (/^https?:\/\//.test(uri)) {
    fullUrl = new URL(uri);
  } else {
    const base = options.baseUrl || '';
    fullUrl = new URL(uri, base.endsWith('/') ? base : base + '/');
  }
  if (options.qs) {
    Object.keys(options.qs).forEach(key => {
      if (options.qs[key] !== undefined && options.qs[key] !== null) {
        fullUrl.searchParams.set(key, String(options.qs[key]));
      }
    });
  }
  return fullUrl;
}

function buildAuthHeader (auth) {
  if (auth.bearer) {
    return `bearer ${auth.bearer}`;
  }
  if (auth.user !== undefined) {
    const credentials = typeof btoa === 'function'
      ? btoa(`${auth.user}:${auth.pass}`)
      : Buffer.from(`${auth.user}:${auth.pass}`).toString('base64');
    return `basic ${credentials}`;
  }
  return undefined;
}

function buildBody (options, headers) {
  if (options.formData) {
    const formData = typeof FormData !== 'undefined' ? new FormData() : new (require('form-data'))();
    Object.keys(options.formData).forEach(key => formData.append(key, options.formData[key]));
    if (options.form) {
      Object.keys(options.form).forEach(key => formData.append(key, options.form[key]));
    }
    return formData;
  }
  if (options.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    return new URLSearchParams(options.form).toString();
  }
  if (options.body) {
    if (options.json) {
      headers['content-type'] = 'application/json';
      return JSON.stringify(options.body);
    }
    return options.body;
  }
  return undefined;
}

async function parseResponseBody (fetchResponse, isJson) {
  if (!isJson) {
    return fetchResponse.text();
  }
  const text = await fetchResponse.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
}

module.exports = function rawRequest (options) {
  const method = (options.method || 'GET').toUpperCase();
  const url = buildUrl(options);
  const headers = Object.assign({}, options.headers || {});

  if (options.auth) {
    const authValue = buildAuthHeader(options.auth);
    if (authValue) {
      headers.Authorization = authValue;
    }
  }

  const body = method !== 'GET' && method !== 'HEAD' ? buildBody(options, headers) : undefined;

  const abortController = new AbortController();

  return new Promise((resolve, reject, onCancel) => {
    onCancel(() => abortController.abort());

    fetch(url.href, {method, headers, body, signal: abortController.signal, redirect: 'follow'})
      .then(fetchResponse => {
        return parseResponseBody(fetchResponse, options.json).then(responseBody => {
          const responseHeaders = {};
          fetchResponse.headers.forEach((value, key) => {
            responseHeaders[key] = value;
          });

          const response = {
            statusCode: fetchResponse.status,
            body: responseBody,
            headers: responseHeaders,
            request: {method, uri: url}
          };

          const success = fetchResponse.ok;

          if (typeof options.transform === 'function') {
            const transformed = options.transform(response.body, response);
            if (!success) {
              const error = new StatusCodeError(`${fetchResponse.status}`);
              error.statusCode = fetchResponse.status;
              error.response = response;
              reject(error);
            } else {
              resolve(transformed);
            }
          } else if (!success) {
            const error = new StatusCodeError(`${fetchResponse.status}`);
            error.statusCode = fetchResponse.status;
            error.response = response;
            reject(error);
          } else if (options.resolveWithFullResponse) {
            resolve(response);
          } else {
            resolve(response.body);
          }
        });
      })
      .catch(err => {
        if (err instanceof StatusCodeError) {
          reject(err);
        } else {
          reject(new RequestError(err.message || 'Network request failed'));
        }
      });
  }).timeout(options.timeout || Math.pow(2, 31) - 1, 'Error: ETIMEDOUT')
    .catch(Promise.TimeoutError, err => {
      abortController.abort();
      throw err;
    });
};
