/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var test = require('tape');
var common = require('./common');


// --- Globals


var KEY = 'ssh-rsa AAAAB3NzaC1yc2EAAAABIwAAAIEAvad19ePSDckmgmo6Unqmd8' +
    'n2G7o1794VN3FazVhV09yooXIuUhA+7OmT7ChiHueayxSubgL2MrO/HvvF/GGVUs/t3e0u4' +
    '5YwRC51EVhyDuqthVJWjKrYxgDMbHru8fc1oV51l0bKdmvmJWbA/VyeJvstoX+eiSGT3Jge' +
    'egSMVtc= mark@foo.local';

var KEY_2 = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDY2qV5e2q8qb+kYtn' +
    'pvRxC5PM6aqPPgWcaXn2gm4jtefGAPuJX9fIkz/KTRRLxdG27IMt6hBXRXvL0Gzw0H0mSUP' +
    'HAbqg4TAyG3/xEHp8iLH/QIf/RwVgjoGB0MLZn7q+L4ThMDo9rIrc5CpfOm/AN9vC4w0Zzu' +
    '/XpJbzjdpTXOh+vmOKkiWCzN+BJ9DvX3iei5NFiSL3rpru0j4CUjBKchUg6X7mdv42g/ZdR' +
    'T9rilmEP154FX/bVsFHitmyyYgba+X90uIR8KGLFZ4eWJNPprJFnCWXrpY5bSOgcS9aWVgC' +
    'oH8sqHatNKUiQpZ4Lsqr+Z4fAf4enldx/KMW91iKn whatever@wherever.local';

var KEY_3 = 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHA' +
    'yNTYAAABBBEazmEPU22E0LgIzFjIJOIpujvWv3UNJ1lVNXYc89Bvm/yHD56UP9HQWRIPTBJ' +
    'Zcbn5/37HhG5JU0CX6cxZxzmc= PIV_slot_9A@B47331299FC7AD6206BA47042A7CF269';
var KEY_3_FP = 'a4:96:76:b6:10:cb:75:d6:84:52:f6:87:ad:83:9a:8f';

var KEY_3_C1 = '-----BEGIN CERTIFICATE-----\n' +
    'MIICQjCCASqgAwIBAgIPc9hpNjnyn+kces3syaD4MA0GCSqGSIb3DQEBCwUAMCEx\n' +
    'HzAdBgNVBAMMFll1YmljbyBQSVYgQXR0ZXN0YXRpb24wIBcNMTYwMzE0MDAwMDAw\n' +
    'WhgPMjA1MjA0MTcwMDAwMDBaMCUxIzAhBgNVBAMMGll1YmlLZXkgUElWIEF0dGVz\n' +
    'dGF0aW9uIDlhMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAERrOYQ9TbYTQuAjMW\n' +
    'Mgk4im6O9a/dQ0nWVU1dhzz0G+b/IcPnpQ/0dBZEg9MEllxufn/fseEbklTQJfpz\n' +
    'FnHOZ6M8MDowEQYKKwYBBAGCxAoDAwQDBAMDMBMGCisGAQQBgsQKAwcEBQIDT43x\n' +
    'MBAGCisGAQQBgsQKAwgEAgIBMA0GCSqGSIb3DQEBCwUAA4IBAQAXJi2Hx5WpfzMs\n' +
    '/9RLDVAjnhVFBZgvqPoAf/BTcfGuI5+uBzNqMttPvETu2TeWPmts9JNJIy4yVy+x\n' +
    'HNs1XeiJqlW82bekz8rGhcwe+tP7Ub/H2YgJrzkZMPEr+HrK2vu7Jj4Z03TtD0Z1\n' +
    'L/6AqvaB/RUBhjWgXfqP91nxoWwWWm0wwttqDWQzyvjWus1YpO60ZI8kyCjLKMgx\n' +
    '6kiB+sG3Wq0VRKpIdj885NunFUnjMCvM895H9sggTiw/mIoAMp7n77ymi2dbTGNI\n' +
    'MT7SS6P1IFRmkRiSQizbfv8Pyedpumjwr17KfbOIKZjWNL8EexY50S3u7S6Fnp61\n' +
    '8LIGjLAI\n' +
    '-----END CERTIFICATE-----';
var KEY_3_C2 = '-----BEGIN CERTIFICATE-----\n' +
    'MIIC5jCCAc6gAwIBAgIJAKSFIqo0r65PMA0GCSqGSIb3DQEBCwUAMCsxKTAnBgNV\n' +
    'BAMMIFl1YmljbyBQSVYgUm9vdCBDQSBTZXJpYWwgMjYzNzUxMCAXDTE2MDMxNDAw\n' +
    'MDAwMFoYDzIwNTIwNDE3MDAwMDAwWjAhMR8wHQYDVQQDDBZZdWJpY28gUElWIEF0\n' +
    'dGVzdGF0aW9uMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq6kLFpvv\n' +
    'Mcw+rBhaLUWAdXDHWLBsPxtZDUm5iehvzrsnb9g8YDqFAO9cvECZPUHu6sCBf3ZI\n' +
    '5KlMvNVr4R8KYJPG/qrSjY7it82LK/eb3VqrL8+5DlTO7I31Xtd7kcOnVpzcwQaG\n' +
    'djZEU/sIJdgGuQaMgf1jZ8o8qLjqHKbK20R7EsqyNAF+c+Q2g9/r+SMABwFqBxmK\n' +
    'ZFadEIrFcwI9GG6vP8MCp8D3ov1tWkJ2TtbAHtbAxqpdpxqfENswVxhctbX9DL5J\n' +
    'JCKvHlZKNETUqtThrpVMdcCIYfSMflTzE+sP5StSYFpuutfljGPaURq7Ilw3K9fR\n' +
    'cFdMLtw1PCKYmwIDAQABoxUwEzARBgorBgEEAYLECgMDBAMEAwMwDQYJKoZIhvcN\n' +
    'AQELBQADggEBAFKAWm3Dnt9HqPGypZyjgIE7HWrrahJiSxH9jTDxe/xxEMmyCPzR\n' +
    'TjV/RfIQolK51LMCGgFWB2v6ZKcI8AP7J6lgjQ3TrFoQzyCWToK8neM32sFMUOE9\n' +
    'FrTK9Bv/CGTJdE8qOkPg3kJ58hOud6HirmvfcqW2ztdMkBPf3tvyizRFizDcUaup\n' +
    'NPip5QxHKaovQlTy+BlatIn+G58ZehbIyLqPGBd6B6mXoVa5Ul2hIcCBZy3oDqZR\n' +
    'uQiwndNgHHCjD/rYYth5KwrmQvz4LfXkzfsVliP/tsCnp+KFg/lwyBlr88E/N0Rl\n' +
    'J/tniMiDty+FH4BEu3LOBoJZLYMA4ZSNoIU=\n' +
    '-----END CERTIFICATE-----';

var CLIENTS;
var CLIENT;
var OTHER;
var SERVER;

var KEY_NAME;


// --- Helpers


function checkKey(t, key) {
    t.ok(key);
    t.ok(key.name);
    t.ok(key.key);
}


// --- Tests


test('setup', function (t) {
    common.setup(function (_, clients, server) {
        CLIENTS = clients;
        CLIENT = clients.user;
        OTHER = clients.other;
        SERVER = server;
        t.end();
    });
});


test('ListKeys (empty) OK', function (t) {
    CLIENT.get('/my/keys', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.ok(body.length);
        t.end();
    });
});


test('CreateKey (missing key)', function (t) {
    CLIENT.post('/my/keys', {}, function (err) {
        t.ok(err);
        t.equal(err.statusCode, 409);
        t.equal(err.restCode, 'MissingParameter');
        t.ok(err.message);
        t.end();
    });
});


test('CreateKey (named) OK', function (t) {
    var key = {
        key: KEY,
        name: 'id_rsa 1'
    };

    CLIENT.post('/my/keys', key, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkKey(t, body);
        t.equal(body.name, key.name);

        CLIENT.get('/my/keys', function (err2, req2, res2, body2) {
            t.ifError(err2);
            t.equal(res2.statusCode, 200);
            common.checkHeaders(t, res2.headers);
            t.ok(body2);
            t.ok(body2.length);
            var key_present = false;
            body2.forEach(function (k) {
                if (k.name === key.name) {
                    key_present = true;
                }
                checkKey(t, k);
            });
            t.ok(key_present);
            t.end();
        });
    });
});


test('Create (named) key with duplicate name', function (t) {
    var key = {
        key: KEY_2,
        name: 'id_rsa 1'
    };

    CLIENT.post('/my/keys', key, function (err, req, res, body) {
        t.ok(err);
        t.equal(err.statusCode, 409);

        t.deepEqual(body, {
            code: 'InvalidArgument',
            message: 'key already exists or is invalid'
        });

        t.end();
    });
});

test('CreateKey (attested) wrong cert', function (t) {
    var key = {
        key: KEY_3,
        attestation: [KEY_3_C2],
        name: 'attest1'
    };

    CLIENT.post('/my/keys', key, function (err, req, res) {
        t.ok(err, 'expect error, got: ' + err);
        if (err) {
            t.equal(err.statusCode, 409,
                'expect 409 status, got ' + err.statusCode);
            t.equal(err.restCode, 'InvalidArgument', 'expect ');
            t.ok(err.message, 'expect some error message, got ' +
                JSON.stringify(err.message));
        }

        t.end();
    });
});

test('CreateKey (attested) OK', function (t) {
    var key = {
        key: KEY_3,
        attestation: [KEY_3_C1, KEY_3_C2],
        name: 'attest2'
    };

    CLIENT.post('/my/keys', key, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        checkKey(t, body);
        t.equal(body.name, key.name);
        t.equal(body.fingerprint, KEY_3_FP);
        t.strictEqual(body.attested, true);
        t.deepEqual(body.multifactor, ['pin']);

        CLIENT.get('/my/keys?sync=true', function (err2, req2, res2, body2) {
            t.ifError(err2);
            t.equal(res2.statusCode, 200);
            common.checkHeaders(t, res2.headers);
            t.ok(body2);
            t.ok(body2.length);
            var key_present = false;
            body2.forEach(function (k) {
                if (k.fingerprint === KEY_3_FP) {
                    key_present = true;
                }
                checkKey(t, k);
            });
            t.ok(key_present);
            t.end();
        });
    });
});

test('Attempt to create with invalid key', function (t) {
    var key = {
        key: 'asdf',
        name: 'Not so valid'
    };

    CLIENT.post('/my/keys', key, function (err, req, res, body) {
        t.ok(err);
        t.equal(err.statusCode, 409);
        t.equal(err.restCode, 'InvalidArgument');
        t.ok(err.message);

        t.deepEqual(body, {
            code: 'InvalidArgument',
            message: 'key is invalid'
        });

        t.end();
    });
});


test('ListKeys OK', function (t) {
    CLIENT.get('/my/keys', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(body.length);
        body.forEach(function (k) {
            checkKey(t, k);
        });
        t.end();
    });
});


// OTHER should only be able to see the key it was created with by setup
test('ListKeys OK - other', function (t) {
    OTHER.get('/my/keys', function (err, req, res, body) {
        t.ifError(err);
        t.equal(body.length, 1);
        t.equal(body[0].name, 'id_rsa');
        t.equal(body[0].fingerprint, '33:06:df:67:4e:fc:b5:e3:da:3b:df:97:' +
                '83:8e:fc:9a');
        t.end();
    });
});


test('GetKey OK', function (t) {
    var url = '/my/keys/' + encodeURIComponent('id_rsa 1');

    CLIENT.get(url, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        checkKey(t, body);
        t.end();
    });
});


test('GetKey OK - other', function (t) {
    var url = '/my/keys/' + encodeURIComponent('id_rsa 1');

    OTHER.get(url, function (err, req, res, body) {
        t.ok(err);
        t.ok(body);

        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);

        t.equal(body.code, 'ResourceNotFound');
        t.ok(body.message);

        t.equal(res.statusCode, 404);

        t.end();
    });
});


test('DeleteKey OK - other', function (t) {
    var url = '/my/keys/' + encodeURIComponent('id_rsa 1');

    OTHER.del(url, function (err) {
        t.ok(err);
        t.equal('ResourceNotFoundError', err.name);
        t.equal('ResourceNotFound', err.restCode);
        t.equal(404, err.statusCode);
        t.equal('id_rsa 1 does not exist', err.message);
        t.end();
    });
});


test('DeleteKey OK', function (t) {
    var url = '/my/keys/' + encodeURIComponent('id_rsa 1');

    CLIENT.del(url, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('DeleteKey 404', function (t) {
    CLIENT.del('/my/keys/' + common.uuid(), function (err) {
        t.ok(err);
        t.equal(err.statusCode, 404);
        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);
        t.end();
    });
});


test('CreateKey OK', function (t) {
    CLIENT.post('/my/keys', { key: KEY }, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        checkKey(t, body);

        KEY_NAME = body.name;

        t.end();
    });
});


test('Cleanup Key', function (t) {
    var path = '/my/keys/' + encodeURIComponent(KEY_NAME);

    CLIENT.del(path, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});

test('Cleanup Key', function (t) {
    var path = '/my/keys/' + encodeURIComponent(KEY_3_FP);

    CLIENT.del(path, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});

test('GetKey 404', function (t) {
    CLIENT.get('/my/keys/' + common.uuid(), function (err) {
        t.ok(err);
        t.equal(err.statusCode, 404);
        t.equal(err.restCode, 'ResourceNotFound');
        t.ok(err.message);
        t.end();
    });
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (err) {
        t.ifError(err, 'teardown success');
        t.end();
    });
});
