"use strict"
import {
    default as _
} from "babel-polyfill"
import logger from 'debug';
import {
    default as Promise
} from "bluebird";
import * as Orientose from './orientose';

const debug = logger("leafjs:orient:models");
const Schema = Orientose.Schema;

export default class ModelBuilder {
    static genModel(file, remove, orientose, http, builders, parentSchema) {
        parentSchema = parentSchema || Schema.V;
        let name = require("path").basename(file, ".js");
        remove = remove === undefined ? false : remove;
        let path = file;
        if (remove) {
            delete require.cache[path];
        }
        let modelDef = require(path);

        let builder = new this(orientose, name, modelDef, http);
        // calling constructor to build
        new modelDef(builder, orientose);
        if (builders) {
            builders.push(builder);
        }
        return Promise.resolve(builder.buildschema(parentSchema));
    }
    constructor(orientose, name, modelDef, http) {
        this._name = name;
        this._props = {};
        this._pre = {};
        this._modelDef = modelDef;
        this._orientose = orientose;
        this._relations = {};
        this._http = http;

        for (let type in Orientose.Type) {
            this.__proto__[type.toLowerCase()] = (function(type) {
                return function(name, options) {
                    options = options || {};
                    options.type = Orientose.Type[type];
                    this.attr(name, options);
                };
            })(type);
        }
        "hasOne hasMany".split(" ").forEach(function(hasType) {
            this.__proto__[hasType] = function(name) {
                this._relations[name] = {
                    clz: name,
                    type: hasType
                };
                let self = this;
                let ret = {};
                "in out both link".split(" ").forEach(function(type) {
                    ret[type] = function(cond) {
                        self._relations[name][type] = cond;
                        self._relations[name].linkType = type;
                    };
                });
                return ret;
            };
        });
    }
    initialize(func) {
        this._initializer = func;
    }
    attr(key, def) {
        if (this._schema) {
            let props = {};
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
        let self = this;
        parent = parent || Schema.V;
        let schema = new parent(self._props, {
            className: this._name
        });

        let names = Object.getOwnPropertyNames(this._modelDef);
        for (let i = 0; i < names.length; i++) {
            let name = names[i];
            let property = Object.getOwnPropertyDescriptor(this._modelDef, name);
            if (require("util").isFunction(property.value)) {
                // debug(property.value, name);
                // statics
                schema.static(name, property.value);
            }
        }
        schema.static("_omodel", function(name) {
            return self._orientose.model(name);
        });

        schema.method("_omodel", function(name) {
            return self._orientose.model(name);
        });

        schema.static("_orientose", function() {
            return self._orientose;
        });

        schema.method("_orientose", function() {
            return self._orientose;
        });

        schema.static("_http", function() {
            return self._http;
        });

        schema.method("_http", function() {
            return self._http;
        });
        names = Object.getOwnPropertyNames(this._modelDef.prototype);
        for (let i = 0; i < names.length; i++) {
            // virtuals and methods
            let name = names[i];
            let desc = Object.getOwnPropertyDescriptor(self._modelDef.prototype, name);
            debug(name, desc);
            if (desc.get || desc.set) {
                var v = schema.virtual(name);
                if (desc.get) {
                    v.get(desc.get);
                }
                if (desc.set) {
                    v.set(desc.set);
                }
            } else {
                schema.method(name, self._modelDef.prototype[name]);
                for (let name in self._relations) {
                    (function(name) {
                        let methodName = name.replace(/^[A-Z]/, function(one) {
                            return one.toLowerCase();
                        });
                        let rel = self._relations[name];
                        if ("link" in rel || "in" in rel || "out" in rel || "both" in rel) {
                            let cond = rel.link || rel.in || rel.out || rel.both;
                            let reverseCond;
                            if ("link" !== rel.linkType) {
                                if (rel.in) {
                                    reverseCond = "out";
                                } else if (rel.out) {
                                    reverseCond = "in";
                                }
                                reverseCond = reverseCond + "('" + cond + "')";
                                cond = rel.linkType + "('" + cond + "')";
                            }
                            var one = rel.type === "hasOne" ? true : false;
                            schema.static("findBy" + name, function _reverseLocate(id) {
                                if (id._id) {
                                    id = id._id;
                                }
                                let self = this;
                                let query = this._orientose()
                                    ._db
                                    .select()
                                    .from(`( select expand(${reverseCond}) from ${id} )`)
                                    .where({
                                        "@class": `${self._model.name}`
                                    });
                                if (one) {
                                    query.limit(1);
                                }
                                let newQuery = function() {};
                                newQuery.query = query;
                                "limit where order let".split(" ").forEach(function(name) {
                                    newQuery[name] = function() {
                                        debug(this.query);
                                        this.query[name].apply(this.query, arguments);
                                        return this;
                                    };
                                });
                                newQuery.then = function(fn) {
                                    let p = query.exec()
                                        .then(function(m) {
                                            debug(m);
                                            let model = self._model;
                                            if (one) {
                                                return Promise.resolve(model._createDocument(m[0]));
                                            }
                                            return Promise.resolve(m.map(function(m) {
                                                return model._createDocument(m);
                                            }));
                                        });
                                    if (fn) {
                                        p = p.then(fn);
                                    }
                                    return p;
                                };
                                return newQuery;
                            });
                            schema.method(methodName, function _getRelation() {
                                let self = this;
                                let query = this._orientose()
                                    ._db
                                    .select()
                                    .from(`( select expand(${cond}) from ${this._id} )`)
                                    .where({
                                        "@class": `${rel.clz}`
                                    });
                                if (one) {
                                    query.limit(1);
                                }
                                let newQuery = function() {};
                                newQuery.query = query;
                                "limit where order let".split(" ").forEach(function(name) {
                                    newQuery[name] = function() {
                                        debug(this.query);
                                        this.query[name].apply(this.query, arguments);
                                        return this;
                                    };
                                });
                                newQuery.then = function(fn) {
                                    let p = query.exec()
                                        .then(function(m) {
                                            debug(m);
                                            let model = self._omodel(rel.clz)._model;
                                            if (one) {
                                                return model._createDocument(m[0]);
                                            }
                                            return Promise.resolve(m.map(function(m) {
                                                return model._createDocument(m);
                                            }));
                                        });
                                    if (fn) {
                                        p = p.then(fn);
                                    }
                                    return p;
                                };
                                return newQuery;
                            });

                        } else {
                            throw "A link type must be defined for " + name;
                        }
                    })(name);
                }
            }
        }
        if (this._pre) {
            for (let name in this._pre) {
                schema.pre(name, (function(name) {
                    return function(done) {
                        debug("running pre", name, here);
                        let here = this;

                        function next(i) {
                            if (i >= self._pre[name].length) {
                                debug(done);
                                return done.call(here);
                            }
                            return self._pre[name][i].call(here, function() {
                                return next(i + 1);
                            });

                        }
                        next(0);
                    };
                })(name));
            }
        }
        self._schema = schema;

        return schema;
    }
    build() {

        let self = this;
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
        let self = this;
        return new Promise(function(resolve, reject) {
            try {
                if (self._later) {
                    for (let i = 0; i < self._later.length; i++) {
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
    embeddedlist(name, fn) {
        this._later = this._later || [];
        this._later.push(function(schemas) {
            if (require("util").isFunction(fn)) {
                this.attr(name, fn(schemas));
            } else {
                this.attr(name, fn);
            }
        });
    };
    embedded(name, fn) {
        this._later = this._later || [];
        this._later.push(function(schemas) {
            if (require("util").isFunction(fn)) {
                this.attr(name, fn(schemas));
            } else {
                this.attr(name, fn);
            }
        });
    };
};