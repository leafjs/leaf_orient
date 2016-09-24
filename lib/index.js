const glob = require('glob');
const debug = require('debug')("leafjs:http:middleware:orient");
const Orientose = require('../dist/orientose').default;
const Schema = Orientose.Schema;

const DEFAULTCONFIG = {
    "base": "app/Model/"
};
var options;

class ModelBuilder {
    constructor(orientose, name, modelDef, app) {
        var self = this;
        self._name = name;
        self._props = {};
        self._pre = {};
        self._modelDef = modelDef;
        this._orientose = orientose;
        this._relations = {};
        this._app = app;
    }
    initialize(func) {
        this._initializer = func;
    }
    attr(key, def) {
        if (this._schema) {
            var props = {};
            props[key] = def;
            this._schema.add(props);
        } else {
            this._props[key] = def;
        }
        return this;
    }
    pre(key, func) {
        this._pre[key] = this._pre[key] || [];
        this._pre[key].push(func);
        return this;
    }
    buildschema(parent) {
        var self = this;
        parent = parent || Schema.V;
        var schema = new parent(self._props, {
            className: this._name
        });

        var names = Object.getOwnPropertyNames(this._modelDef);
        for ( let i = 0; i < names.length; i++ ) {
            var name = names[i];
            var property = Object.getOwnPropertyDescriptor(this._modelDef, name);
            if ( require("util").isFunction(property.value)) {
                // debug(property.value, name);
                // statics
                schema.static(name, property.value);
            }
        }
        schema.static("_omodel", function(name){
            return self._orientose.model(name);
        });

        schema.method("_omodel", function(name){
            return self._orientose.model(name);
        });

        schema.static("_orientose", function(){
            return self._orientose;
        });

        schema.method("_orientose", function(){
            return self._orientose;
        });

        schema.static("_app", function(){
            return self._app;
        });

        schema.method("_app", function(){
            return self._app;
        });
        names = Object.getOwnPropertyNames(this._modelDef.prototype);
        for ( let i = 0; i < names.length; i++ ) {
            // virtuals and methods
            let name = names[i];
            var desc = Object.getOwnPropertyDescriptor(self._modelDef.prototype, name);
            debug(name, desc);
            if ( desc.get || desc.set ) {
                var v = schema.virtual(name);
                if ( desc.get ) {
                    v.get(desc.get);
                }
                if ( desc.set ) {
                    v.set(desc.set);
                }
            } else {
                schema.method(name, self._modelDef.prototype[name]);
                for (let name in self._relations ) {
                    (function(name) {
                        var methodName = name.replace(/^[A-Z]/, function(one){ return one.toLowerCase();});
                        var rel = self._relations[name];
                        if ( "link" in rel || "in" in rel || "out" in rel || "both" in rel ) {
                            var cond = rel.link || rel.in || rel.out || rel.both;
                            var reverseCond;
                            if ( "link" !== rel.linkType ) {
                                if ( rel.in ) {
                                    reverseCond = "out";
                                } else if ( rel.out ) {
                                    reverseCond = "in";
                                }
                                reverseCond = reverseCond+"('"+cond+"')";
                                cond = rel.linkType+"('"+cond+"')";
                            }
                            var one = rel.type === "hasOne" ? true : false;
                            schema.static("findBy"+name, function _reverseLocate(id){
                                if ( id._id ) {
                                    id = id._id;
                                }
                                var self = this;
                                var query = this._orientose()
                                        ._db
                                        .select()
                                        .from(`( select expand(${reverseCond}) from ${id} )`)
                                        .where({"@class": `${self._model.name}`});
                                if ( one ) {
                                    query.limit(1);
                                }
                                var newQuery = function(){};
                                newQuery.query = query;
                                "limit where order let".split(" ").forEach(function(name){
                                    newQuery[name] = function(){
                                        debug(this.query);
                                        this.query[name].apply(this.query, arguments);
                                        return this;
                                    };
                                });
                                newQuery.then = function(fn){
                                    var p = query.exec()
                                    .then(function(m){
                                        debug(m);
                                        var model = self._model;
                                        if ( one ) {
                                            return Promise.resolve(model._createDocument(m[0]));
                                        }
                                        return Promise.resolve(m.map(function(m){
                                            return model._createDocument(m);
                                        }));
                                    });
                                    if ( fn ) {
                                        p = p.then(fn);
                                    }
                                    return p;
                                };
                                return newQuery;
                            });
                            schema.method(methodName, function _getRelation(){
                                var self = this;
                                var query = this._orientose()
                                        ._db
                                        .select()
                                        .from(`( select expand(${cond}) from ${this._id} )`)
                                        .where({"@class": `${rel.clz}`});
                                if ( one ) {
                                    query.limit(1);
                                }
                                var newQuery = function(){};
                                newQuery.query = query;
                                "limit where order let".split(" ").forEach(function(name){
                                    newQuery[name] = function(){
                                        debug(this.query);
                                        this.query[name].apply(this.query, arguments);
                                        return this;
                                    };
                                });
                                newQuery.then = function(fn){
                                    var p = query.exec()
                                    .then(function(m){
                                        debug(m);
                                        var model = self._omodel(rel.clz)._model;
                                        debug("creating models?");
                                        if ( one ) {
                                            debug("creating just one?", m[0]);
                                            return model._createDocument(m[0]);
                                        }
                                        return Promise.resolve(m.map(function(m){
                                            return model._createDocument(m);
                                        }));
                                    });
                                    if ( fn ) {
                                        p = p.then(fn);
                                    }
                                    return p;
                                };
                                return newQuery;
                            });

                        } else {
                            throw "A link type must be defined for "+name;
                        }
                    })(name);
                }
            }
        }
        if (this._pre) {
            for (let name in this._pre) {
                schema.pre(name, (function(name){
                    return function(done){
                        debug("running pre", name, here);
                        var here = this;
                        function next(i){
                            if ( i >= self._pre[name].length ) {
                                debug(done);
                                return done.call(here);
                            }
                            return self._pre[name][i].call(here, function(){
                                return next(i+1);
                            });

                        }
                        next(0);
                    };
                })(name));
            }
        }
        self._schema = schema;

        // debug(schema);

        return schema;
    }
    build() {

        var self = this;
        return self._orientose.model(self._name, self._schema, {
            ensure: false
        }).then(function(model) {
            return Promise.resolve([self._name, model]);
        }).catch(function(err) {
            debug("Failed to create", self._name, err.stack);
            return Promise.reject(err);
        });
    }
    beforebuild(schemas) {
        var self = this;
        return new Promise(function(resolve, reject) {
            try {
                if (self._later) {
                    for (var i = 0; i < self._later.length; i++) {
                        self._later[i].call(self, schemas);
                    }
                    return resolve();
                }
                resolve();
            } catch (e) {
                debug(e.stack);
                reject(e);
            }
        });
    }
    timestamps() {
        this.date("updated_at", {
            default: Date.now()
        });
        this.pre("save", function(done) {
            if (this._isNew) {
                this.created_at = Date.now();
            }
            this.updated_at = Date.now();
            done();
        });
        this.date("created_at", {
            default: Date.now()
        });
    }
}

for (var type in Orientose.Type) {
    ModelBuilder.prototype[type.toLowerCase()] = (function(type) {
        return function(name, options) {
            options = options || {};
            options.type = Orientose.Type[type];
            this.attr(name, options);
        };
    })(type);
}

ModelBuilder.prototype.embeddedlist = function(name, fn) {
    this._later = this._later || [];
    this._later.push(function(schemas) {
        if (require("util").isFunction(fn)) {
            this.attr(name, fn(schemas));
        } else {
            this.attr(name, fn);
        }
    });
};

ModelBuilder.prototype.embedded = function(name, fn) {
    this._later = this._later || [];
    this._later.push(function(schemas) {
        if (require("util").isFunction(fn)) {
            this.attr(name, fn(schemas));
        } else {
            this.attr(name, fn);
        }
    });
};

"hasOne hasMany".split(" ").forEach(function(hasType){
    ModelBuilder.prototype[hasType] = function(name) {
        this._relations[name] = {
            clz: name,
            type: hasType
        };
        var self = this;
        var ret = {};
        "in out both link".split(" ").forEach(function(type){
            ret[type] = function(cond) {
                self._relations[name][type] = cond;
                self._relations[name].linkType = type;
            };
        });
        return ret;
    };
});

function genModel(file, remove, orientose, app, builders, parentSchema) {
    parentSchema = parentSchema || Schema.V;
    var name = require("path").basename(file, ".js");
    remove = remove === undefined ? false : remove;
    var path = file;
    if (remove) {
        delete require.cache[path];
    }
    var modelDef = require(path);

    var builder = new ModelBuilder(orientose, name, modelDef, app);
    // calling constructor to build
    new modelDef(builder, orientose);
    if (builders) {
        builders.push(builder);
    }
    return Promise.resolve(builder.buildschema(parentSchema));
}

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
