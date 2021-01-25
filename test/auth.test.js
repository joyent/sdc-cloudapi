/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

var util = require('util');
var crypto = require('crypto');
var Keyapi = require('keyapi');
var test = require('tape');
var restify = require('restify');
var vasync = require('vasync');
var url = require('url');
var sshpk = require('sshpk');
var qs = require('querystring');

var common = require('./common');
var checkNotFound = common.checkNotFound;
var checkNotAuthorized = common.checkNotAuthorized;
var waitForMahiCache = common.waitForMahiCache;



// --- Globals


var SIGNATURE_FMT = 'Signature keyId="%s",algorithm="%s" %s';

var CLIENTS;
var CLIENT;
var SUB_CLIENT;
var OTHER;
var SERVER;

var POLICY_NAME;
var ROLE_NAME;
var ROLE_UUID;
var XROLE_NAME;


// --- Tests


test('setup', function (t) {
    common.setup({ clientApiVersion: '~8' }, function (_, clients, server) {
        CLIENTS = clients;
        SERVER = server;

        CLIENT = clients.user;
        SUB_CLIENT = clients.subuser;
        OTHER = clients.other;

        ROLE_NAME = CLIENT.role.name;
        POLICY_NAME = CLIENT.policy.name;

        XROLE_NAME = CLIENT.xrole.name;

        t.end();
    });
});


test('signature auth', function (t) {
    CLIENT.get('/my/keys', function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(/Signature/.test(req._headers.authorization));
        t.ok(body);
        t.ok(Array.isArray(body));
        t.ok(body.length);
        t.end();
    });
});


test('pre-signed url', function (t) {
    var key = sshpk.parsePrivateKey(CLIENT.privateKey);
    var path = '/my/keys';
    var host = url.parse(SERVER.url).host;

    var params = {
        algorithm: key.type + '-' + key.defaultHashAlgorithm(),
        expires: Math.round(Date.now() / 1000) + 300,
        keyId: CLIENT.keyId
    };

    var signstr = 'GET\n' + host + '\n' + path + '\n' + qs.stringify(params);
    var signer = key.createSign();
    signer.update(signstr);
    params.signature = signer.sign().toString();

    path += '?' + qs.stringify(params);

    CLIENT.get(path, function (err, req, res, body) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(body);
        t.ok(Array.isArray(body));
        t.ok(body.length);
        t.end();
    });
});

test('pre-signed url - expired', function (t) {
    var key = sshpk.parsePrivateKey(CLIENT.privateKey);
    var path = '/my/keys';
    var host = url.parse(SERVER.url).host;

    var params = {};
    params.algorithm = key.type + '-' + key.defaultHashAlgorithm();
    params.expires = Math.round(Date.now() / 1000) - 300;
    params.keyId = CLIENT.keyId;

    var signstr = 'GET\n' + host + '\n' + path + '\n' + qs.stringify(params);
    var signer = key.createSign();
    signer.update(signstr);
    params.signature = signer.sign().toString();

    path += '?' + qs.stringify(params);

    CLIENT.get(path, function (err, req, res) {
        t.ok(err);
        t.end();
    });
});

test('pre-signed url - missing params', function (t) {
    var key = sshpk.parsePrivateKey(CLIENT.privateKey);
    var path = '/my/keys';
    var host = url.parse(SERVER.url).host;

    var params = {};
    params.expires = Math.round(Date.now() / 1000) + 300;
    params.keyId = CLIENT.keyId;

    var signstr = 'GET\n' + host + '\n' + path + '\n' + qs.stringify(params);
    var signer = key.createSign();
    signer.update(signstr);
    params.signature = signer.sign().toString();

    path += '?' + qs.stringify(params);

    CLIENT.get(path, function (err, req, res) {
        t.ok(err);
        t.end();
    });
});

test('pre-signed url - wrong host', function (t) {
    var key = sshpk.parsePrivateKey(CLIENT.privateKey);
    var path = '/my/keys';
    var host = 'invalid.host.example.com';

    var params = {};
    params.algorithm = key.type + '-' + key.defaultHashAlgorithm();
    params.expires = Math.round(Date.now() / 1000) + 300;
    params.keyId = CLIENT.keyId;

    var signstr = 'GET\n' + host + '\n' + path + '\n' + qs.stringify(params);
    var signer = key.createSign();
    signer.update(signstr);
    params.signature = signer.sign().toString();

    path += '?' + qs.stringify(params);

    CLIENT.get(path, function (err, req, res) {
        t.ok(err);
        t.end();
    });
});

// http-signature 0.10.x test
var httpSignature = require('http-signature');
function requestSigner(req) {
    httpSignature.sign(req, {
        key: CLIENT.privateKey,
        keyId: CLIENT.keyId
    });
}

test('signature auth (http-signature 0.10.x)', function (t) {
    var cli = restify.createJsonClient({
        url: SERVER.url,
        retryOptions: {
            retry: 0
        },
        log: CLIENT.log,
        rejectUnauthorized: false,
        signRequest: requestSigner
    });

    cli.get({
        path: '/my/keys',
        headers: {
            'accept-version': '~7.1'
        }
    }, function (err, req, res, obj) {
        t.ifError(err);
        t.equal(res.statusCode, 200);
        common.checkHeaders(t, res.headers);
        t.ok(/Signature/.test(req._headers.authorization));
        t.ok(obj);
        t.ok(Array.isArray(obj));
        t.ok(obj.length);
        cli.close();
        t.end();
    });
});



test('token auth', function (t) {
    var config = common.getCfg();
    var keyapi = new Keyapi({ log: config.log, ufds: config.ufds });

    var now = new Date().toUTCString();
    var alg = 'RSA-SHA256';

    var signer = crypto.createSign(alg);
    signer.update(now);
    var sig = signer.sign(CLIENT.privateKey, 'base64');

    var authorization = util.format(SIGNATURE_FMT, CLIENT.keyId,
                                    alg.toLowerCase(), sig);

    var sigClient = restify.createJsonClient({
        url: SERVER.url,
        version: '*',
        retryOptions: {
            retry: 0
        },
        log: CLIENT.log,
        rejectUnauthorized: false
    });

    function generateRequest(token) {
        return {
            path: '/admin/keys',
            headers: {
                // do not change case of 'date'; some versions of restify won't
                // override the date then, and sporadic failures occur
                date: now,
                'x-auth-token': JSON.stringify(token),
                'api-version': '~8.0',
                authorization: authorization
            }
        };
    }

    function callWithBadDetails(_t, details) {
        keyapi.token(details, function (err, token) {
            _t.ifError(err);

            var obj = generateRequest(token);

            sigClient.get(obj, function (err2, req, res, body) {
                _t.ok(err2);
                _t.deepEqual(body, {
                    code: 'InvalidCredentials',
                    message: 'The token provided is not authorized for this ' +
                            'application'
                });

                _t.end();
            });
        });
    }

    t.test('token with empty details', function (t2) {
        callWithBadDetails(t2, {});
    });

    t.test('token with wrong permission path', function (t2) {
        var tokenDetails = {
            account: CLIENT.account,
            devkeyId: CLIENT.keyId,
            permissions: { cloudapi: ['/admin/other_things'] },
            expires: new Date(+new Date() + 1000).toISOString()
        };

        callWithBadDetails(t2, tokenDetails);
    });

    t.test('token with wrong expires', function (t2) {
        var tokenDetails = {
            account: CLIENT.account,
            devkeyId: CLIENT.keyId,
            permissions: { cloudapi: ['/admin/keys'] },
            expires: new Date(+new Date() - 1000).toISOString()
        };

        callWithBadDetails(t2, tokenDetails);
    });

    t.test('token with wrong devkeyId', function (t2) {
        var tokenDetails = {
            account: CLIENT.account,
            devkeyId: '/verybadkey@joyent.com/keys/id_rsa',
            permissions: { cloudapi: ['/admin/keys'] },
            expires: new Date(+new Date() + 1000).toISOString()
        };

        callWithBadDetails(t2, tokenDetails);
    });

    t.test('token auth response', function (t2) {
        var tokenDetails = {
            account: CLIENT.account,
            devkeyId: CLIENT.keyId,
            permissions: { cloudapi: ['/admin/keys'] },
            expires: new Date(+new Date() + 1000).toISOString()
        };

        keyapi.token(tokenDetails, function (err, token) {
            t2.ifError(err);

            var obj = generateRequest(token);

            sigClient.get(obj, function (er1, req, res, body) {
                t2.ifError(er1, 'Token client error');
                t2.equal(res.statusCode, 200, 'Token client status code');
                common.checkHeaders(t2, res.headers);
                t2.ok(/Signature/.test(req._headers.authorization), 'Sig');
                t2.ok(body, 'Token body');
                t2.ok(Array.isArray(body), 'Token body is array');
                // This is admin user, which always has keys
                t2.ok(body.length, 'Admin has keys');

                sigClient.close();
                t2.end();
            });
        });
    });

    t.end();
});


// We need to create a new user here, because the ufds entries cached
// inside cloudapi conflict with simple updates of the existing user. That
// implies skipping using the existing http client.
test('auth of disabled account', function (t) {
    function attemptGet(err, _, signer, cb) {
        t.ifError(err);

        var httpClient = restify.createJsonClient({
            url: CLIENT.url.href, // grab from old client
            retryOptions: { retry: 0 },
            log: CLIENT.log,
            rejectUnauthorized: false,
            signRequest: signer
        });

        httpClient.get('/my', function (err2, req, res, body) {
            t.ok(err2);

            t.deepEqual(body, {
                code: 'NotAuthorized',
                message: 'Account or user is disabled'
            });

            httpClient.close();

            cb();
        });
    }

    function done() {
        t.end();
    }

    var opts = {
        disabled: true
    };

    common.withTemporaryUser(CLIENT.ufds, opts, attemptGet, done);
});


// Account sub-users will use only http-signature >= 0.10.x, given this
// feature has been added after moving from 0.9.
// Also, request version will always be >= 7.2 here.
test('tag resource collection with role', function (t) {
    CLIENT.put('/my/users', {
        'role-tag': [ROLE_NAME]
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.name, 'resource role name');
        t.ok(body['role-tag'], 'resource role tag');
        t.ok(body['role-tag'].length, 'resource role tag ary');
        t.end();
    });
});


test('tag resource collection with non-existent role', function (t) {
    CLIENT.put('/my/users', {
        'role-tag': ['asdasdasdasd']
    }, function (err) {
        t.equal('Role(s) asdasdasdasd not found', err.message);
        t.equal('InvalidArgumentError', err.name);
        t.equal('InvalidArgument', err.restCode);
        t.equal(409, err.statusCode);
        t.end();
    });
});


test('get resource collection role-tag', function (t) {
    var p = '/my/users';
    CLIENT.get({
        path: p
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body[0].login, 'resource is a user');
        t.ok(res.headers['role-tag'], 'resource role-tag header');
        t.equal(res.headers['role-tag'], ROLE_NAME, 'resource role-tag');
        t.end();
    });
});


test('tag individual resource with role', function (t) {
    CLIENT.put('/my/users/' + SUB_CLIENT.login, {
        'role-tag': [ROLE_NAME]
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.name, 'resource role name');
        t.ok(body['role-tag'], 'resource role tag');
        t.ok(body['role-tag'].length, 'resource role tag ary');
        t.end();
    });
});


test('tag individual resource with role - other', function (t) {
    OTHER.put('/my/users/' + SUB_CLIENT.login, {
        'role-tag': [ROLE_NAME]
    }, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('tag individual resource with non-existent role', function (t) {
    CLIENT.put('/my/users/' + SUB_CLIENT.login, {
        'role-tag': ['asdasdasdasd']
    }, function (err) {
        t.equal('Role(s) asdasdasdasd not found', err.message);
        t.equal('InvalidArgumentError', err.name);
        t.equal('InvalidArgument', err.restCode);
        t.equal(409, err.statusCode);
        t.end();
    });
});


test('tag individual resource with non-existent role - other', function (t) {
    OTHER.put('/my/users/' + SUB_CLIENT.login, {
        'role-tag': ['asdasdasdasd']
    }, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('get individual resource role-tag', function (t) {
    CLIENT.get('/my/users/' + SUB_CLIENT.login, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.login, 'resource is a user');
        t.ok(res.headers['role-tag'], 'resource role-tag header');
        t.equal(res.headers['role-tag'], ROLE_NAME, 'resource role-tag');
        t.end();
    });
});


test('get individual resource role-tag - other', function (t) {
    OTHER.get('/my/users/' + SUB_CLIENT.login, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('sub-user signature auth (0.10)', function (t) {
    function subRequestSigner(req) {
        httpSignature.sign(req, {
            key: SUB_CLIENT.privateKey,
            keyId: SUB_CLIENT.keyId
        });
    }

    var mPath = util.format('/user/%s/%s', CLIENT.login, SUB_CLIENT.login);
    // We need to check that mahi-replicator has caught up with our latest
    // operation, which is adding the test-role to the test sub user:
    function waitMahiReplicator(cb) {
        waitForMahiCache(CLIENT.mahi, mPath, function (er, cache) {
            if (er) {
                CLIENT.log.error({err: er}, 'Error fetching mahi resource');
                t.fail('Error fetching mahi resource');
                t.end();
            } else {
                if (!cache.roles || Object.keys(cache.roles).length === 0 ||
                    Object.keys(cache.roles).indexOf(CLIENT.role.uuid) === -1) {
                    setTimeout(function () {
                        waitMahiReplicator(cb);
                    }, 1000);
                } else {
                    cb();
                    return;
                }
            }
        });
    }


    waitMahiReplicator(function () {
        var cli = restify.createJsonClient({
            url: SERVER.url,
            retryOptions: {
                retry: 0
            },
            log: CLIENT.log,
            rejectUnauthorized: false,
            signRequest: subRequestSigner
        });

        t.test('sub-user get account', function (t2) {
            cli.get({
                path: '/' + CLIENT.login,
                headers: {
                    'accept-version': '~7.2'
                }
            }, function (err, req, res) {
                t2.ok(err, 'sub-user get account error');
                t2.equal(res.statusCode, 403, 'sub-user auth statusCode');
                t2.end();
            });
        });

        t.test('sub-user get users', function (t1) {
            cli.get({
                path: '/' + CLIENT.login + '/users',
                headers: {
                    'accept-version': '~7.2'
                }
            }, function (err, req, res) {
                t1.ifError(err, 'sub-user get users error');
                t1.equal(res.statusCode, 200, 'sub-user auth statusCode');
                t1.end();
            });
        });

        // Even when we've added the role-tag, the policies into the role don't
        // include a rule with route::string = 'getuser', therefore the 403:
        t.test('sub-user get thyself', function (t3) {
            cli.get({
                path: util.format('/%s/users/%s', CLIENT.login,
                                    SUB_CLIENT.login),
                headers: {
                    'accept-version': '~7.2'
                }
            }, function (err, req, res) {
                t3.ok(err, 'sub-user get thyself error');
                t3.equal(res.statusCode, 403, 'sub-user auth statusCode');
                cli.close();
                t3.end();
            });
        });

        t.test('sub-user with as-role', function (t4) {
            var accountUuid = CLIENT.account.uuid;
            var roleUuid = CLIENT.role.uuid;
            var ufds = CLIENT.ufds;

            var oldDefaultMembers;
            function getRole(_, cb) {
                ufds.getRole(accountUuid, roleUuid, function (err, role) {
                    if (err) {
                        return cb(err);
                    }

                    oldDefaultMembers = role.uniquememberdefault;

                    return cb();
                });
            }

            function removeDefaultMembers(_, cb) {
                var changes = { uniquememberdefault: null };
                ufds.modifyRole(accountUuid, roleUuid, changes, cb);
            }

            function checkCannotGet(_, cb) {
                cli.get({
                    path: '/' + CLIENT.login + '/users',
                    headers: {
                        'accept-version': '~7.2'
                    }
                }, function (err, req, res) {
                    cli.close();

                    if (err && err.statusCode !== 403) {
                        return cb(err);
                    }

                    return cb();
                });
            }

            function checkCanGetWithRole(_, cb) {
                cli.get({
                    path: '/' + CLIENT.login + '/users?as-role=' +
                            CLIENT.role.name,
                    headers: {
                        'accept-version': '~7.2'
                    }
                }, function (err, req, res) {
                    if (err) {
                        return cb(err);
                    }

                    cli.close();


                    if (res.statusCode !== 200) {
                        var msg = 'checkCanGetWithRole did not return 200';
                        return cb(new Error(msg));
                    }

                    return cb();
                });
            }

            function revertDefaultMembers(_, cb) {
                var changes = { uniquememberdefault: oldDefaultMembers };
                ufds.modifyRole(accountUuid, roleUuid, changes, cb);
            }

            vasync.pipeline({
                funcs: [
                    getRole, removeDefaultMembers, checkCannotGet,
                    checkCanGetWithRole, revertDefaultMembers
                ]
            }, function (err) {
                t4.ifError(err, 'sub-user with as-role error');
                t4.end();
            });
        });

        t.end();
    });
});


test('create role with role-tag', function (t) {
    var roleUuid = common.uuid();
    var name = 'a' + roleUuid.substr(0, 7);

    var entry = {
        name: name,
        members: SUB_CLIENT.login,
        policies: [POLICY_NAME],
        default_members: SUB_CLIENT.login
    };

    CLIENT.post({
        path: '/my/roles',
        headers: {
            'role-tag': [ROLE_NAME]
        }
    }, entry, function (err, req, res, body) {
        t.ifError(err);
        t.ok(body);
        t.equal(res.statusCode, 201);
        common.checkHeaders(t, res.headers);
        ROLE_UUID = body.id;
        t.end();
    });
});


test('update role with role-tag', function (t) {
    var p = '/my/roles/' + ROLE_UUID;
    CLIENT.post({
        path: p,
        headers: {
            'role-tag': [ROLE_NAME]
        }
    }, {
        name: 'Something-different'
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.end();
    });
});


test('update role with role-tag - other', function (t) {
    var p = '/my/roles/' + ROLE_UUID;
    OTHER.post({
        path: p,
        headers: {
            'role-tag': [ROLE_NAME]
        }
    }, {
        name: 'Something-different'
    }, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('delete role with role-tag - other', function (t) {
    OTHER.del('/my/roles/' + ROLE_UUID, function (err, req, res, body) {
        checkNotFound(t, err, req, res, body);
        t.end();
    });
});


test('delete role with role-tag', function (t) {
    CLIENT.del('/my/roles/' + ROLE_UUID, function (err, req, res) {
        t.ifError(err);
        t.equal(res.statusCode, 204);
        common.checkHeaders(t, res.headers);
        t.end();
    });
});


test('tag /:account with role', function (t) {
    CLIENT.put('/' + CLIENT.login, {
        'role-tag': [ROLE_NAME]
    }, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.name, 'resource role name');
        t.ok(body['role-tag'], 'resource role tag');
        t.ok(body['role-tag'].length, 'resource role tag ary');
        t.end();
    });
});


test('tag /:account with role - other', function (t) {
    OTHER.put('/' + CLIENT.login, {
        'role-tag': [ROLE_NAME]
    }, function (err, req, res, body) {
        checkNotAuthorized(t, err, req, res, body);
        t.end();
    });
});


test('get /:account role-tag', function (t) {
    CLIENT.get('/' + CLIENT.login, function (err, req, res, body) {
        t.ifError(err, 'resource role err');
        t.ok(body, 'resource role body');
        t.ok(body.login, 'resource is a user');
        t.ok(res.headers['role-tag'], 'resource role-tag header');
        t.equal(res.headers['role-tag'], ROLE_NAME, 'resource role-tag');
        t.end();
    });
});


test('get /:account role-tag - other', function (t) {
    OTHER.get('/' + CLIENT.login, function (err, req, res, body) {
        checkNotAuthorized(t, err, req, res, body);
        t.end();
    });
});


test('get /:account/keys - other no xacct role', function (t) {
    OTHER.get('/' + CLIENT.login + '/keys', function (err, req, res, body) {
        checkNotAuthorized(t, err, req, res, body);
        t.end();
    });
});

test('get /:account/keys - other xacct role', function (t) {
    OTHER.get('/' + CLIENT.login + '/keys?as-role=' + XROLE_NAME,
        function (err, req, res, body) {
        t.ifError(err, 'other xacct role keys err');
        t.ok(body, 'other xacct role keys body');
        t.ok(Array.isArray(body), 'resource is an array');
        t.ok(body[0].fingerprint, 'resource array contains keys');
        t.end();
    });
});


test('cleanup resources', function (t) {
    common.deleteResources(CLIENT, function (err) {
        t.ifError(err);
        t.end();
    });
});


test('teardown', function (t) {
    common.teardown(CLIENTS, SERVER, function (err) {
        t.ifError(err, 'teardown success');
        t.end();
    });
});
