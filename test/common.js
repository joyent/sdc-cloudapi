/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2020 Joyent, Inc.
 */

/*
 * Functions used in more than one test file + setup/teardown
 * preparation for every test suite.
 */

var assert = require('assert-plus');
var crypto = require('crypto');
var path = require('path');
var bunyan = require('bunyan');
var restify = require('restify');
const { v4: uuidv4 } = require('uuid');
var util = require('util');
var fs = require('fs');
var semver = require('semver');
var vasync = require('vasync');

var UFDS = require('ufds');
var VMAPI = require('sdc-clients').VMAPI;
var CNAPI = require('sdc-clients').CNAPI;
var NAPI = require('sdc-clients').NAPI;
var IMGAPI = require('sdc-clients').IMGAPI;
var PAPI = require('sdc-clients').PAPI;
var MAHI = require('mahi');
var VOLAPI = require('sdc-clients').VOLAPI;

var apertureConfig = require('aperture-config').config;


// --- Globals

var SDC_128_PACKAGE = {
    uuid: '897779dc-9ce7-4042-8879-a4adccc94353',
    name: 'sdc_128_ok',
    version: '1.0.0',
    max_physical_memory: 128,
    quota: 10240,
    max_swap: 256,
    cpu_cap: 150,
    max_lwps: 1000,
    zfs_io_priority: 10,
    fss: 25,
    'default': false,
    vcpus: 1,
    active: true
};

var KVM_128_PACKAGE = Object.assign({}, SDC_128_PACKAGE, {
    uuid: 'e70c5264-b7e5-11e8-90a4-6b259cf00b80',
    brand: 'kvm',
    name: 'sdc_128_kvm'
});

var BHYVE_128_PACKAGE = Object.assign({}, SDC_128_PACKAGE, {
    uuid: 'e83d57d2-b7e5-11e8-84bb-7be61e455e35',
    brand: 'bhyve',
    name: 'sdc_128_bhyve',
    max_physical_memory: 256,
    max_swap: 512
});

var BHYVE_128_FLEX_PACKAGE = Object.assign({}, BHYVE_128_PACKAGE, {
    uuid: '8b3b6796-e5b1-47ce-bb49-ac9dcba7c6eb',
    brand: 'bhyve',
    name: 'sdc_128_flex_bhyve',
    quota: 20 * 1024, // 50 GiB
    flexible_disk: true
});

var PASSWD = 'secret123';
var DEFAULT_CFG = path.join(__dirname, '..', '/etc/cloudapi.cfg');

var LOG = new bunyan.createLogger({
    level: process.env.LOG_LEVEL || 'warn',
    name: 'sdccloudapitest',
    stream: process.stderr,
    serializers: restify.bunyan.serializers
});

var CONFIG = {};
try {
    CONFIG = JSON.parse(fs.readFileSync(DEFAULT_CFG, 'utf8'));
} catch (_e) {
    // Looking forward for optional catch binding ...
}

var SIGNATURE_FMT = 'Signature keyId="%s",algorithm="%s" %s';


// --- Functions


function uuid() {
    return uuidv4();
}


function requestSigner(req, keyId, privateKey) {
    var d = req.getHeader('Date');

    if (!d) {
        d = new Date().toUTCString();
        req.setHeader('Date', d);
    }

    var alg = 'RSA-SHA256';

    var signer = crypto.createSign(alg);
    signer.update(d);
    var sig = signer.sign(privateKey, 'base64');

    var authHeader = util.format(SIGNATURE_FMT, keyId, alg.toLowerCase(), sig);
    req.setHeader('Authorization', authHeader);
}


// Unavoidably, we need to poll some jobs
function _wfapi() {
    return restify.createJsonClient({
        url: process.env.WFAPI_URL || CONFIG.wfapi.url || 'http://10.99.99.19',
        version: '*',
        retryOptions: {
            retry: 0
        },
        log: LOG,
        agent: false
    });
}


// We need vmapi client to check jobs on tests, given if we
// just wait for vmachine status change, we'll be just
// hanging forever.
function _vmapi() {
    return new VMAPI({
        url: process.env.VMAPI_URL || CONFIG.vmapi.url || 'http://10.99.99.28',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: LOG,
        agent: false
    });
}


function _cnapi() {
    return new CNAPI({
        url: process.env.CNAPI_URL || CONFIG.cnapi.url || 'http://10.99.99.22',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: LOG,
        agent: false
    });
}


function _napi() {
    return new NAPI({
        url: process.env.NAPI_URL || CONFIG.napi.url || 'http://10.99.99.10',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: LOG,
        agent: false
    });
}


function _imgapi() {
    return new IMGAPI({
        url: process.env.IMGAPI_URL || CONFIG.imgapi.url ||
            'http://10.99.99.21',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: LOG,
        agent: false
    });
}

function _joyentImgapi() {
    return new IMGAPI({
        url: 'https://images.joyent.com/',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: LOG,
        agent: false
    });
}


function _papi() {
    return PAPI({
        url: process.env.PAPI_URL || CONFIG.papi.url || 'http://10.99.99.30',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: LOG,
        agent: false
    });
}


function _mahi() {
    return MAHI.createClient({
        url: process.env.MAHI_URL || CONFIG.mahi.url ||
        'http://10.99.99.34:8080',
        typeTable: apertureConfig.typeTable,
        maxAuthCacheSize: 1,
        maxAuthCacheAgeMs: 5
    });
}


function _ufds() {
    return new UFDS({
        url: process.env.UFDS_URL || CONFIG.ufds.url || 'ldaps://10.99.99.18',
        bindDN: CONFIG.ufds.bindDN || 'cn=root',
        bindPassword: CONFIG.ufds.bindPassword || 'secret',
        log: LOG,
        tlsOptions: {
            rejectUnauthorized: false
        },
        retry: {
            initialDelay: 100
        }
    });
}

function _volapi() {
    return new VOLAPI({
        version: '^1',
        userAgent: 'cloudapi-tests',
        url: process.env.VOLAPI_URL || CONFIG.volapi.url ||
            'http://10.99.99.41',
        retry: {
            retries: 1,
            minTimeout: 1000
        },
        log: LOG,
        agent: false
    });
}

/*
 * Destroy all data associated with a client.
 */
function clientDataTeardown(client, cb) {
    assert.object(client, 'client');
    assert.func(cb, 'callback');

    var ufds = client.ufds;
    var dc = CONFIG.datacenter_name;
    var account = client.account;
    var id = account.uuid;
    var sub = account.account; // has parent account UUID if this acc a subuser

    var pollDelay = 500; // in ms

    ufds.deleteKey(account, 'id_rsa', function deleteKeyCb(err) {
        if (err) {
            cb(err);
            return;
        }

        pollKeyDeletion();
    });

    var pollKeyCount = 10;
    function pollKeyDeletion() {
        --pollKeyCount;
        if (pollKeyCount === 0) {
            cb(new Error('Key failed to delete in time'));
            return;
        }

        ufds.getKey(account, 'id_rsa', function getKeyCb(err) {
            if (err) {
                if (err.restCode !== 'ResourceNotFound') {
                    cb(err);
                    return;
                }

                if (!sub) {
                    pollConfigDeletion();
                } else {
                    ufds.deleteUser(account, cb);
                }
                return;
            }

            setTimeout(pollKeyDeletion, pollDelay);
        });
    }

    var pollConfigCount = 10;
    function pollConfigDeletion() {
        --pollConfigCount;
        if (pollConfigCount === 0) {
            cb(new Error('Config failed to delete in time'));
            return;
        }

        ufds.deleteDcLocalConfig(id, dc, function delConfigCb(err2) {
            if (err2) {
                if (err2.restCode !== 'ResourceNotFound') {
                    cb(err2);
                    return;
                }
                ufds.deleteUser(account, cb);
                return;
            }

            setTimeout(pollConfigDeletion, pollDelay);
        });
    }
}


/*
 * Close all client connections.
 */
function clientClose(client, cb) {
    assert.object(client, 'client');
    assert.func(cb, 'callback');

    client.close();
    client.mahi.close();

    var ufds = client.ufds;
    ufds.client.removeAllListeners('close');
    ufds.client.removeAllListeners('timeout');
    ufds.removeAllListeners('timeout');
    ufds.close(cb);
}


/**
 * Check and log the request ID header
 */
function checkReqId(t, headers) {
    var reqID = headers['request-id'];
    t.ok(reqID, 'request ID: ' + reqID);
}


function createTestRole(client, subUserAccount, cb) {
    var entry = {
        name: 'test-role',
        uniquemember: [subUserAccount.dn],
        memberpolicy: [client.policy.dn],
        uniquememberdefault: [subUserAccount.dn],
        account: client.account.uuid
    };

    client.ufds.addRole(client.account.uuid, entry, function (err, role) {
        if (err) {
            return cb(err);
        }

        client.role = role;

        return cb();
    });
}


function createTestPolicy(client, cb) {
    var entry = {
        name: 'test-policy',
        rule: [
            'CAN getaccount',
            'CAN listusers',
            'CAN createuser',
            'CAN listkeys AND listuserkeys',
            'CAN rebootmachine, createmachine AND getmachine',
            'CAN setroletags'
        ],
        description: 'Policy used by test helper',
        account: client.account.uuid
    };

    client.ufds.addPolicy(client.account.uuid, entry, function (err, policy) {
        if (err) {
            return cb(err);
        }

        client.policy = policy;

        return cb();
    });
}

function createXTestPolicy(client, cb) {
    var entry = {
        name: 'x-test-policy',
        rule: [
            'CAN listkeys and headkeys *'
        ],
        description: 'Policy used by test helper',
        account: client.account.uuid
    };

    client.ufds.addPolicy(client.account.uuid, entry, function (err, policy) {
        if (err) {
            return cb(err);
        }

        client.xpolicy = policy;

        return cb();
    });
}


function createXTestRole(client, otherAccount, cb) {
    var entry = {
        name: 'x-test-role',
        uniquemember: [otherAccount.dn],
        memberpolicy: [client.xpolicy.dn],
        account: client.account.uuid
    };

    client.ufds.addRole(client.account.uuid, entry, function (err, role) {
        if (err) {
            return cb(err);
        }

        client.xrole = role;

        return cb();
    });
}


function addUserKey(client, keyPath, cb) {
    var publicKey = fs.readFileSync(keyPath + '.pub', 'ascii');
    var privateKey = fs.readFileSync(keyPath, 'ascii');

    client.publicKey = publicKey;
    client.privateKey = privateKey;

    var obj = {
        openssh: publicKey,
        name: 'id_rsa'
    };

    return client.account.addKey(obj, cb);
}


function addUser(client, keyPath, parentAccount, cb) {
    var ufds = client.ufds;

    var entry = {
        login: client.login,
        email: client.login,
        userpassword: client.passwd,
        registered_developer: true,
        approved_for_provisioning: true
    };

    if (parentAccount) {
        entry.account = parentAccount.uuid;
    } else {
        entry.registered_developer = true;
        entry.approved_for_provisioning = true;
    }

    return ufds.addUser(entry, function (err, customer) {
        if (err) {
            return cb(err);
        }

        client.account = customer;

        return addUserKey(client, keyPath, cb);
    });
}


function setupClient(version, serverUrl, user, keyId, keyPath, parentAcc, cb) {
    var client = restify.createJsonClient({
        url: serverUrl,
        version: version,
        retryOptions: {
            retry: 0
        },
        log: LOG,
        rejectUnauthorized: false,
        signRequest: function (req) {
            requestSigner(req, client.keyId, client.privateKey);
        }
    });

    client.login = user;
    client.passwd = PASSWD;
    client.keyId = keyId;
    client.datacenter = CONFIG.datacenter_name;

    // Create clients to all the APIs
    client.wfapi = _wfapi();
    client.vmapi = _vmapi();
    client.cnapi = _cnapi();
    client.napi = _napi();
    client.imgapi = _imgapi();
    client.joyentImgapi = _joyentImgapi();
    client.papi = _papi();
    client.mahi = _mahi();
    client.ufds = _ufds();
    if (CONFIG.experimental_cloudapi_nfs_shared_volumes === true) {
        client.volapi = _volapi();
    }

    var ufds = client.ufds;

    ufds.once('error', cb);

    ufds.once('connect', function () {
        ufds.removeAllListeners('error');

        ufds.on('error', function (err) {
            LOG.warn(err, 'UFDS: unexpected error occurred');
        });

        ufds.on('close', function () {
            LOG.warn('UFDS: disconnected');
        });

        ufds.on('connect', function () {
            LOG.info('UFDS: reconnected');
        });

        addUser(client, keyPath, parentAcc, function (err) {
            cb(err, client);
        });
    });
}


function loadServer(cb) {
    var serverObj = {
        url: 'https://127.0.0.1'
    };

    cb(null, serverObj);
}


function checkMahiCache(mahiclient, apath, cb) {
    mahiclient._get(apath, function (err, res) {
        if (err) {
            if (err.name === 'AccountDoesNotExistError' ||
                err.name === 'UserDoesNotExistError') {
                return cb(null, false);
            } else {
                return cb(err);
            }
        }

        return cb(null, true, res);
    });
}


function waitForMahiCache(mahiclient, apath, cb) {
    LOG.info('Polling mahi for %s', apath);

    return checkMahiCache(mahiclient, apath, function (err, ready, res) {
        if (err) {
            return cb(err);
        }

        if (!ready) {
            return setTimeout(function () {
                waitForMahiCache(mahiclient, apath, cb);
            }, process.env.POLL_INTERVAL || 1000);
        }

        return cb(null, res);
    });
}


function waitForAccountConfigReady(client, cb) {
    assert.object(client, 'client');
    assert.func(cb, 'callback');

    if (!CONFIG.fabrics_enabled) {
        cb();
        return;
    }

    var nbTries = 0;
    var MAX_NB_TRIES = 20;
    var TRY_DELAY_IN_MS = 1000;

    function getConfig() {
        ++nbTries;
        if (nbTries >= MAX_NB_TRIES) {
            cb(new Error('max number of tries reached'));
            return;
        }

        client.get('/my/config', function onGetConfig(err, req, res, config) {
            if (err) {
                cb(err);
                return;
            }

            if (config.default_network) {
                cb();
                return;
            }
            setTimeout(getConfig, TRY_DELAY_IN_MS);
        });
    }

    getConfig();
}


// Creates a temporary user, invokes bodyCb(), destroys the user, then invokes
// cb(). Useful for running tests in bodyCb() with a user that'll be destroyed
// after bodyCb() completes.
function withTemporaryUser(ufdsClient, userOpts, bodyCb, cb) {
    var tmpUser = 'a' + uuid().substr(0, 7) + '.test@joyent.com';

    var keyPath = __dirname + '/testkeys/id_rsa';
    var publicKey = fs.readFileSync(keyPath + '.pub', 'ascii');
    var privateKey = fs.readFileSync(keyPath, 'ascii');

    var entry = {
        login: tmpUser,
        email: tmpUser,
        userpassword: 'BlahBlahBlah12345',
        approved_for_provisioning: true,
        disabled: false
    };

    // add or override default user values with anything in userOpts
    Object.keys(userOpts).forEach(function (key) {
        entry[key] = userOpts[key];
    });

    ufdsClient.addUser(entry, createTmpUser);

    // FIXME: I don't think this is properly working. `callback` is
    // never called.
    function createTmpUser(err, tmpAccount, _callback) {
        if (err) {
            return invokeBodyCb(err);
        }

        tmpAccount.passwd = entry.userpassword; // sometimes bodyCb needs this

        return ufdsClient.addKey(tmpAccount, {
            openssh: publicKey,
            name: 'id_rsa'
        }, function (err3, tmpKey) {
            invokeBodyCb(err3, tmpAccount, tmpKey);
        });
    }

    function invokeBodyCb(err, tmpAccount, tmpKey) {
        var keyId = '/' + tmpAccount.uuid + '/keys/id_rsa';

        function signer(req) {
            requestSigner(req, keyId, privateKey);
        }

        bodyCb(err, tmpAccount, signer, function () {
            destroyTmpUser(null, tmpAccount, tmpKey);
        });
    }

    function destroyTmpUser(_err, tmpAccount, tmpKey) {
        // ignore errors, and hope things work out
        ufdsClient.deleteKey(tmpAccount, tmpKey, function () {
            ufdsClient.deleteUser(tmpAccount, cb);
        });
    }
}


function objCopy(obj, target) {
    if (!target) {
        target = {};
    }
    Object.keys(obj).forEach(function (k) {
        target[k] = obj[k];
    });
    return target;
}



/*
 * Setup a cloudapi test run: test account, subuser, "other" user (for
 * visibility/privacy tests), package, etc.
 *
 * @param opts {Object} Optional.
 *      - opts.clientApiVersion {String} A 'version' to use for the cloudapi
 *        clients. Defaults to '*' (i.e. the latest cloudapi API version).
 * @param cb {Function}
 */
function setup(opts, cb) {
    if (cb === undefined) {
        cb = opts;
        opts = {};
    }
    assert.object(opts, 'opts');
    assert.func(cb, 'cb');
    assert.optionalString(opts.clientApiVersion, 'opts.clientApiVersion');
    var clientApiVersion = opts.clientApiVersion || '*';

    assert.ok(cb);

    var user = 'a' + uuid().substr(0, 7) + '.test@joyent.com';
    var userKeyPath = __dirname + '/testkeys/id_rsa';
    var userKeyId = '/' + user + '/keys/id_rsa';

    var subUser = 'a' + uuid().substr(0, 7) + '.sub.test@joyent.com';
    var subUserKeyPath = __dirname + '/testkeys/sub_id_rsa';
    var subUserKeyId = '/' + user + '/users/' + subUser + '/keys/id_rsa';

    var otherUser = 'a' + uuid().substr(0, 7) + '.other.test@joyent.com';
    var otherUserKeyPath = __dirname + '/testkeys/other_id_rsa';
    var otherUserKeyId = '/' + otherUser + '/keys/id_rsa';

    CONFIG.log = LOG;

    var userClient;
    var subUserClient;
    var otherUserClient;
    var server;

    vasync.pipeline({ funcs: [
        function setupServer(_, next) {
            loadServer(function (err, _server) {
                server = _server;
                next(err);
            });
        },
        function setupUserClient(_, next) {
            setupClient(clientApiVersion, server.url, user, userKeyId,
                    userKeyPath, null, function (err, client) {
                userClient = client;
                next(err);
            });
        },
        function setupSubUserClient(_, next) {
            setupClient(clientApiVersion, server.url, subUser, subUserKeyId,
                        subUserKeyPath, userClient.account,
                        function (err, client) {
                subUserClient = client;
                next(err);
            });
        },
        function setupOtherClient(_, next) {
            setupClient(clientApiVersion, server.url, otherUser, otherUserKeyId,
                        otherUserKeyPath, null, function (err, client) {
                otherUserClient = client;
                next(err);
            });
        },
        function setupPolicy(_, next) {
            createTestPolicy(userClient, next);
        },
        function setupRole(_, next) {
            createTestRole(userClient, subUserClient.account, next);
        },
        function setupXPolicy(_, next) {
            createXTestPolicy(userClient, next);
        },
        function setupXRole(_, next) {
            createXTestRole(userClient, otherUserClient.account, next);
        },
        function setupPackage(_, next) {
            addPackage(userClient, SDC_128_PACKAGE, next);
        },
        function waitUserClientConfig(_, next) {
            waitForAccountConfigReady(userClient, next);
        },
        function waitOtherUserClientConfig(_, next) {
            waitForAccountConfigReady(otherUserClient, next);
        }
    ] }, function (err) {
        if (err) {
            throw err;
        }

        assert.object(userClient);
        assert.object(subUserClient);
        assert.object(otherUserClient);
        assert.object(server);

        var clients = {
            user: userClient,
            subuser: subUserClient,
            other: otherUserClient
        };

        cb(null, clients, server);
    });
}


function teardown(clients, server, cb) {
    assert.object(clients, 'clients');
    assert.object(server, 'server');
    assert.func(cb, 'callback');

    var userClient = clients.user;
    var subUserClient = clients.subuser;
    var otherUserClient = clients.other;

    var ufds = userClient.ufds;
    var accUuid = userClient.account.uuid;

    vasync.pipeline({ funcs: [
        function (_, next) {
            ufds.deleteRole(accUuid, userClient.role.uuid, next);
        },
        function (_, next) {
            ufds.deletePolicy(accUuid, userClient.policy.uuid, next);
        },
        function (_, next) {
            ufds.deleteRole(accUuid, userClient.xrole.uuid, next);
        },
        function (_, next) {
            ufds.deletePolicy(accUuid, userClient.xpolicy.uuid, next);
        },
        function (_, next) {
            deletePackage(userClient, SDC_128_PACKAGE, next);
        },
        function (_, next) {
            clientDataTeardown(subUserClient, next);
        },
        function (_, next) {
            clientDataTeardown(userClient, next);
        },
        function (_, next) {
            clientDataTeardown(otherUserClient, next);
        }
    ]}, function teardownCb(err) {
        // we defer errors here to finish(), because otherwise it's likely
        // we'll hang
        clientClose(subUserClient, function (err2) {
            clientClose(userClient, function (err3) {
                clientClose(otherUserClient, function (err4) {
                    function finish(err5) {
                        cb(err || err2 || err3 || err4 || err5);
                    }

                    if (server.close) {
                        server.close(finish);
                    } else {
                        finish();
                    }
                });
            });
        });
    });
}


function checkHeaders(t, headers) {
    assert.ok(t);
    t.ok(headers, 'headers ok');

    if (!headers) {
        return;
    }

    t.ok(headers['access-control-allow-origin'], 'headers allow-origin');
    t.ok(headers['access-control-allow-methods'], 'headers allow-methods');
    t.ok(headers.date, 'headers date');
    t.ok(headers['request-id'], 'headers request-id');
    t.ok(headers['response-time'] >= 0, 'headers response time');
    t.ok(headers.server, 'headers server');
    t.ok(headers['api-version'], 'headers api-version OK');
}


function checkVersionHeader(t, version, headers) {
    assert.ok(t);
    assert.ok(version);

    var msg = util.format('headers api-version %s', version);
    t.equal(headers['api-version'], version, msg);
}


function addPackage(client, pkg, cb) {
    client.papi.get(pkg.uuid, {}, function (err, p) {
        if (!err) {
            return cb(null, p);
        }

        if (err.restCode === 'ResourceNotFound') {
            return client.papi.add(pkg, cb);
        } else {
            return cb(err);
        }
    });
}


function deletePackage(client, pkg, cb) {
    client.papi.del(pkg.uuid, { force: true }, cb);
}


function deleteResources(client, cb) {
    var id = client.account.uuid;

    client.ufds.listResources(id, function listResourcesCb(err, resources) {
        if (err) {
            cb(err);
            return;
        }

        vasync.forEachPipeline({
            inputs: resources,
            func: function (resource, next) {
                client.ufds.deleteResource(id, resource.uuid, next);
            }
        }, cb);
    });
}


/*
 * Find a server to use for test provisions. We'll just use a running headnode
 * (the simple case that works for COAL). Limitation: This assumes headnode
 * provisioning is enabled (e.g. via 'sdcadm post-setup dev-headnode-prov').
 */
function getTestServer(client, cb) {
    client.cnapi.listServers({
        headnode: true,
        extras: 'sysinfo'
    }, function (err, servers) {
        if (err) {
            cb(err);
            return;
        }

        var runningHeadnodes = servers.filter(function (s) {
            return s.status === 'running';
        });

        if (runningHeadnodes.length === 0) {
            cb(new Error('could not find a test server'));
            return;
        }
        cb(null, runningHeadnodes[0]);
    });
}


function getTestImage(client, cb) {
    // Note: Keep this image name@version in sync with tools/coal-setup.sh.
    var testImageName = 'minimal-64-lts';
    client.get('/my/images?name=' + testImageName,
            function (err, req, res, images) {
        if (err) {
            cb(err);
            return;
        } else if (images.length < 1) {
            cb(new Error('no "' + testImageName + '" image was found'));
            return;
        }

        var image = images[images.length - 1];
        cb(null, image);
    });
}


function checkNotFound(t, err, req, res, body) {
    t.ok(err);
    t.ok(body);

    t.equal(err.restCode, 'ResourceNotFound');
    t.ok(err.message);

    t.equal(body.code, 'ResourceNotFound');
    t.ok(body.message);

    t.equal(res.statusCode, 404);
}


function checkNotAuthorized(t, err, req, res, body) {
    t.ok(err);
    t.ok(body);

    t.equal(err.restCode, 'NotAuthorized');
    t.ok(err.message);

    t.equal(body.code, 'NotAuthorized');
    t.ok(body.message);

    t.equal(res.statusCode, 403);
}


function checkInvalidArgument(t, err, req, res, body) {
        t.ok(err);
        t.ok(body);

        t.equal(err.restCode, 'InvalidArgument');
        t.ok(err.message);

        t.equal(body.code, 'InvalidArgument');
        t.ok(body.message);

        t.equal(res.statusCode, 409);
}


// --- some NAPI client conveniences

/*
 * Delete the given network by name. It is not an error if the name doesn't
 * exist.
 */
function napiDeleteNetworkByName(opts, cb) {
    assert.object(opts.napi, 'opts.napi');
    assert.string(opts.name, 'opts.name');

    opts.napi.listNetworks({name: opts.name}, function (err, nets) {
        if (err) {
            cb(err);
            return;
        }
        if (nets.length > 1) {
            cb(new Error(util.format(
                'unexpectedly more than one network named "%s": %j',
                opts.name, nets)));
            return;
        }
        if (nets.length === 1) {
            opts.napi.deleteNetwork(nets[0].uuid, cb);
            return;
        }
        cb();
    });
}


/*
 * Delete the given network pool name. It is not an error if it doesn't exist.
 */
function napiDeletePoolByName(opts, cb) {
    assert.object(opts.napi, 'opts.napi');
    assert.string(opts.name, 'opts.name');

    // Can't use `ListNetworkPools?name=name` (see NAPI-344).
    opts.napi.listNetworkPools(function (err, pools) {
        if (err) {
            cb(err);
            return;
        }

        var matches = pools.filter(
            function (pool) { return pool.name === opts.name; });
        if (matches.length > 1) {
            cb(new Error(util.format(
                'unexpectedly more than one network pool named "%s": %j',
                opts.name, matches)));
            return;
        }
        if (matches.length === 1) {
            opts.napi.deleteNetworkPool(matches[0].uuid, cb);
            return;
        }
        cb();
    });
}

/*
 * Delete the given nic tag. It is not an error if it doesn't exist.
 */
function napiDeleteNicTagByName(opts, cb) {
    assert.object(opts.napi, 'opts.napi');
    assert.string(opts.name, 'opts.name');

    opts.napi.getNicTag(opts.name, function (err) {
        if (!err) {
            opts.napi.deleteNicTag(opts.name, cb);
            return;
        }
        if (err.statusCode === 404) {
            cb();
            return;
        }
        cb(err);
    });
}


function externalNicMacFromServer(server) {
    assert.object(server, 'server');
    assert.object(server.sysinfo, 'server.sysinfo');

    var mac;
    var ifaces = server.sysinfo['Network Interfaces'];
    assert.object(ifaces, 'ifaces');

    var nic = Object.keys(ifaces).map(function (iname) {
        return ifaces[iname];
    }).filter(function findExternalNic(iface) {
        assert.object(iface, 'iface');
        var nicNames = iface['NIC Names'];
        assert.arrayOfString(nicNames, 'nicNames');
        return nicNames.indexOf('external') !== -1;
    })[0];

    assert.object(nic, 'nic');
    mac = nic['MAC Address'];
    assert.string(mac, 'mac');

    return mac;
}


/*
 * Add the given NIC tags to the server's external NIC.
 *
 * Calls back with `function (err, job)` where `job` is the the CNAPI
 * NicUpdate response body (i.e. `job.job_uuid` is the workflow job UUID).
 */
function addNicTagsToServer(nicTags, server, client, callback) {
    assert.arrayOfString(nicTags, 'nicTags');
    assert.object(server, 'server');
    assert.object(client, 'client');
    assert.func(callback, 'callback');

    var args = {
        action: 'update',
        nics: [ {
            mac: externalNicMacFromServer(server),
            nic_tags_provided: nicTags
        } ]
    };
    client.cnapi.updateNics(server.uuid, args, function (err, body, res) {
        callback(err, body);
    });
}


function removeTagsFromServer(nicTags, server, client, callback) {
    assert.arrayOfString(nicTags, 'nicTags');
    assert.object(server, 'server');
    assert.object(client, 'client');
    assert.func(callback, 'callback');

    var args = {
        action: 'delete',
        nics: [ {
            mac: externalNicMacFromServer(server),
            nic_tags_provided: nicTags
        } ]
    };
    client.cnapi.updateNics(server.uuid, args, function (err, body, res) {
        callback(err, body);
    });
}

/*
 * Make the already imported image with name "imageName" provisionable by making
 * it public.
 *
 * @param {Object} client (required): a CloudAPI client instance as passed to
 *   common.setup's callback's second parameter.
 *
 * @param {String} imageName (required): the name of the image to make
 *   provisionable
 *
 * @param {Function} callback (required): called at the end of the process as
 *   callback(err, provisionableImgObject)
 *
 * where "provisionableImgObject" represents an image with an "id" property that
 * stores its UUID.
 */
function makeImageProvisionable(client, imageName, callback) {
    assert.object(client, 'client');
    assert.string(imageName, 'imageName');
    assert.func(callback, 'callback');

    var context = {};

    vasync.pipeline({arg: context, funcs: [
        function listImportedImages(ctx, next) {
            client.get('/my/images?name=' + imageName,
                function onListImportedImages(listImagesErr, req, res, images) {
                    if (listImagesErr) {
                        next(listImagesErr);
                        return;
                    }

                    if (!images || images.length === 0) {
                        next(new Error('Could not find image with name: ' +
                            imageName));
                        return;
                    }

                    ctx.images = images;
                    next();
                });
        },
        /*
         * When images are imported into a DC's IMGAPI because they're an origin
         * image for another image imported from updates.joyent.com, their
         * "public" attribute is set to false, which makes them
         * non-provisionable. In this case, we just update that public property
         * to "true".
         */
        function ensureOneImportedImgIsPublic(ctx, next) {
            var firstImage;
            var publicImages;

            assert.optionalArrayOfObject(ctx.images, 'ctx.images');

            if (ctx.images && ctx.images.length > 0) {
                publicImages = ctx.images.filter(function isPublic(image) {
                    return image.public;
                });

                if (publicImages.length > 0) {
                    ctx.provisionableImage = publicImages[0];
                    next();
                    return;
                }
                firstImage = ctx.images[0];
                firstImage.public = true;
                client.imgapi.updateImage(firstImage.uuid, firstImage,
                    client.account.uuid,
                    function onImageUpdated(updateImgErr) {
                        if (updateImgErr) {
                            next(updateImgErr);
                            return;
                        }

                        ctx.provisionableImage = firstImage;
                        next();
                        return;
                    });
            }
            next();
        }
    ]}, function onAllDone(err) {
        callback(err, context.provisionableImage);
    });
}

/*
 * Compare the given `ver` with the cloudapi version in the server header.
 *
 * Callback fires as (err, cmpResult), where cmpResult is as below:
 *    1  if `ver` >  cloudapiVer
 *    0  if `ver` == cloudapiVer
 *   -1  if `ver` <  cloudapiVer
 */
function cloudapiServerHeaderVersionCmp(ver, serverHeader) {
    var match = serverHeader.match(/^cloudapi\/(.*)$/i);
    if (!match) {
        throw new Error('cloudapiVersionCmp: unexpected server header ' +
            'format: ' + serverHeader);
    }

    return semver.compare(match[1], ver);
}

/*
 * Returns true if the CloudAPI server version is greater than or equal to the
 * given version, else returns false.
 */
function cloudapiServerHeaderGtrOrEq(serverHeader, ver) {
    try {
        return cloudapiServerHeaderVersionCmp(ver, serverHeader) >= 0;
    } catch (ex) {
        console.log('Error determining cloudapi server version: ' + ex);
        return false;
    }
}


// --- Library


module.exports = {
    setup: setup,
    teardown: teardown,
    checkHeaders: checkHeaders,
    checkReqId: checkReqId,
    checkVersionHeader: checkVersionHeader,
    checkMahiCache: checkMahiCache,
    checkNotAuthorized: checkNotAuthorized,
    checkNotFound: checkNotFound,
    checkInvalidArgument: checkInvalidArgument,
    cloudapiServerHeaderGtrOrEq: cloudapiServerHeaderGtrOrEq,

    waitForMahiCache: waitForMahiCache,
    withTemporaryUser: withTemporaryUser,
    objCopy: objCopy,

    // XXX `uuid` export should die. Don't want randomness in the test cases.
    uuid: uuid,
    addPackage: addPackage,
    deletePackage: deletePackage,
    getTestServer: getTestServer,
    getTestImage: getTestImage,

    deleteResources: deleteResources,

    // Some NAPI client conveniences
    napiDeleteNicTagByName: napiDeleteNicTagByName,
    napiDeleteNetworkByName: napiDeleteNetworkByName,
    napiDeletePoolByName: napiDeletePoolByName,

    // common functions to add/remove nic tags in tests
    addNicTagsToServer: addNicTagsToServer,
    removeTagsFromServer: removeTagsFromServer,

    sdc_128_package: SDC_128_PACKAGE,
    kvm_128_package: KVM_128_PACKAGE,
    bhyve_128_package: BHYVE_128_PACKAGE,
    bhyve_128_flex_package: BHYVE_128_FLEX_PACKAGE,

    getCfg: function () {
        return CONFIG;
    },

    makeImageProvisionable: makeImageProvisionable
};
