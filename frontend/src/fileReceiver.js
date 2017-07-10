const EventEmitter = require('events');
const { hexToArray } = require('./utils');

class FileReceiver extends EventEmitter {
  constructor() {
    super();
    this.salt = hexToArray(location.pathname.slice(10, -1));
  }

  download() {
    return Promise.all([
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.onprogress = event => {
          if (event.lengthComputable) {
            const percentComplete = Math.floor(
              event.loaded / event.total * 100
            );
            this.emit('progress', percentComplete);
          }
        };

        xhr.onload = function(event) {
          if (xhr.status === 404) {
            reject(
              new Error('The file has expired, or has already been deleted.')
            );
            return;
          }

          const blob = new Blob([this.response]);
          const fileReader = new FileReader();
          fileReader.onload = function() {
            const meta = JSON.parse(xhr.getResponseHeader('X-File-Metadata'));
            resolve({
              data: this.result,
              aad: meta.aad,
              filename: meta.filename,
              iv: meta.iv
            });
          };

          fileReader.readAsArrayBuffer(blob);
        };

        xhr.open('get', '/assets' + location.pathname.slice(0, -1), true);
        xhr.responseType = 'blob';
        xhr.send();
      }),
      window.crypto.subtle.importKey(
        'jwk',
        {
          kty: 'oct',
          k: location.hash.slice(1),
          alg: 'A128GCM',
          ext: true
        },
        {
          name: 'AES-GCM'
        },
        true,
        ['encrypt', 'decrypt']
      )
    ]).then(([fdata, key]) => {
      return Promise.all([
        window.crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: hexToArray(fdata.iv),
            additionalData: hexToArray(fdata.aad)
          },
          key,
          fdata.data
        ),
        new Promise((resolve, reject) => {
          resolve(fdata.filename);
        }),
        new Promise((resolve, reject) => {
          resolve(hexToArray(fdata.aad));
        })
      ]);
    }).then(([decrypted, fname, proposedHash]) => {
      return window.crypto.subtle.digest('SHA-256', decrypted).then(calculatedHash => {
        const integrity = new Uint8Array(calculatedHash).toString() === proposedHash.toString();
        if (!integrity) {
          return new Promise((resolve, reject) => {
            console.log('This file has been tampered with.')
            reject();
          })
        }
        
        return Promise.all([
          new Promise((resolve, reject) => {
            resolve(decrypted);
          }),
          new Promise((resolve, reject) => {
            resolve(fname);
          })
        ]);
      })
    })
  }
}

module.exports = FileReceiver;
