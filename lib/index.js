const glob = require('glob');
const debug = require('debug')("leafjs:http:middleware:orient");
const ModelBuilder = require('../dist');
const Orientose = require('../dist/orientose').default;
const Schema = Orientose.Schema;

const DEFAULTCONFIG = {
    "base": "app/Model/"
};
var options;

class ORM {
    static getConfig(http) {
        let config = require("extend")({}, DEFAULTCONFIG, {
            connection: {}
        });
        var _config = http._config.db || {};
        let username = _config.username || "root";
        let password = _config.password || "root";
        let host = _config.host || "localhost";
        let port = _config.port || "2424";
        let dbname = _config.dbname || http._config.name;

        if (!dbname) {
            throw "dbname or package name has to be provided";
        }
        if (http.env !== "production") {
            dbname = `${dbname}-${http.env}`;
        }
        config.connection = {
            host: host,
            user: username,
            password: password,
            port: port,
            name: dbname,
            logger: {
                debug: require('debug')("orientose:debug")
            }
        };
        return config;
    }
    static getManager(http) {
        let orientose = this.getOrientose(http);
        let name = http.config.name.replace(/[_-][a-zA-Z0-9]/g, function(match) {
            return match[1].toUpperCase();
        });
        let manager = new Orientose.Orientjs.Migration.Manager({
            db: orientose._db,
            dir: http.basepath + "/db/migrations",
            className: name + "Migration"
        });
        return manager;
    }
    static createMigration(http, name) {
        let manager = this.getManager(http);
        return manager.create(name);
    }
    static migrate(http) {
        let manager = this.getManager(http);
        return manager.up().catch(function(e) {
            debug(e.stack);
        });
    }
    static rollback(http) {
        let manager = this.getManager(http);
        return manager.down(1);
    }
    static reset(http) {
        let manager = this.getManager(http);
        return manager.down();
    }
    static seed(http) {
        return new Promise(function(resolve, reject) {
            glob(require("path").resolve(http.basepath, "db/seed/*.js"), function(er, files) {
                if (er) {
                    return reject(er);
                }
                let promises = [];
                for (let file of files) {
                    let seeding = require(file);
                    promises.push(seeding.seed(http));
                }

                function next(i) {
                    if (i >= promises.length) {
                        return resolve();
                    }
                    debug("loading", promises[i]);
                    promises[i].then(function() {
                        next(i + 1);
                    }).catch(function(e) {
                        debug("Failed to seed", e, e.stack);
                        reject();
                    });
                }
                next(0);
            });
        });
    }
    static getOrientose(http) {
        try {
            let dbConfig = this.getConfig(http);
            debug("Using this dbConfig", dbConfig);
            let orm = new Orientose(dbConfig.connection, dbConfig.connection.name);
            return orm;
        } catch (e) {
            debug("failed to create orientose", e, e.stack);
            throw e;
        }
    }
}

class middleware {
    constructor(opts) {
        options = opts || {};
    }

    static get ORM() {
        return ORM;
    }

    * initialize(next) {
        let koa = this.koa;
        let http = this;

        let _config = require("extend")({}, DEFAULTCONFIG, {
            connection: {}
        });

        let promises = [],
            builders = [],
            schemas = {};

        debug("using leafjs orientdb middleware");
        http._orm = ORM.getOrientose(http);
        http.ORM = ORM;
        http.Orientose = Orientose;
        koa.use(function*(next) {
            debug("use koa orientdb middleware");
            this.models = http.models;
            yield * next;
        });
        http.models = {};

        yield new Promise(function(resolve, reject) {
            glob(require("path").resolve(http.basepath, _config.base + "vertex/*.js"), function(er, files) {
                if (er) {
                    return reject(er);
                }

                for (let file of files) {
                    promises.push(genModel(file, http.env !== "production", http._orm, http, builders));
                    debug(`loading ${file}`);
                }
                for (let i = 0; i < builders.length; i++) {
                    schemas[builders[i]._name] = builders[i]._schema;
                }
                resolve();
            });

        }).then(function() {
            return new Promise(function(resolve, reject) {
                glob(require("path").resolve(http.basepath, _config.base + "edge/*.js"), function(er, files) {
                    if (er) {
                        return reject(er);
                    }
                    for (let file of files) {
                        promises.push(genModel(file, http.env !== "production", http._orm, http, builders, Schema.E));
                        debug(`loading ${file}`);
                    }
                    for (let i = 0; i < builders.length; i++) {
                        schemas[builders[i]._name] = builders[i]._schema;
                    }
                    resolve();
                });
            });
        }).then(function() {
            return Promise.all(promises);
        }).then(function(names) {
            debug("getting all the names", names);
            return Promise.all(builders.map(function(b) {
                return b.beforebuild(schemas);
            }));
        }).then(function() {
            return Promise.all(builders.map(function(b) {
                return b.build();
            }));
        }).then(function(models) {
            for (let i = 0; i < models.length; i++) {
                http.models[models[i][0]] = models[i][1];
            }
        });
        yield * next;
    } * destroy(next) {
        debug("destroy leafjs orientdb middleware");
        let http = this;
        yield Promise.all([
            http._orm._server.close(),
            http._orm._db.close()
        ]);
        yield * next;
    }
}

exports = module.exports = middleware;