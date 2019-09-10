module.exports.createProxy = ({ entityType, getters = {}, methods = {}, } = {}) => {
  Object.entries(getters).forEach(([ getter, callback, ]) => {
    if (typeof callback !== 'function') {
      throw new Error(
        'Proxy getters should be functions, ' +
        `but getter "${getter}" is of type ${typeof callback}.`
      )
    }

    if (callback.length) {
      throw new Error(
        'Proxy getters should not accept any arguments, ' +
        `but getter "${getter}" accepts ${callback.length} argument(s).`
      )
    }

    if (/^[^{]+?=>/.test(callback.toString())) {
      throw new Error(
        `Proxy getters should not be arrow functions, but getter "${getter}" is. ` +
        `Replace its declaration with "${getter}() {...}" or "${getter}: function() {...}" ` +
        'in order to enable "this" binding.'
      )
    }
  })

  Object.entries(methods).forEach(([ method, callback, ]) => {
    if (typeof callback !== 'function') {
      throw new Error(
        'Proxy methods should be functions, ' +
        `but method "${method}" is of type ${typeof callback}.`
      )
    }

    if (/^[^{]+?=>/.test(callback.toString())) {
      throw new Error(
        `Proxy methods should not be arrow functions, but method "${method}" is. ` +
        `Replace its declaration with "${method}() {...}" or "${method}: function() {...}" ` +
        'in order to enable "this" binding.'
      )
    }
  })

  getters.entityLoader = getters.entityLoader || function() {
    if (!this.context.loaders) {
      throw new Error(
        'The proxy context.loaders is not defined. ' +
        'Either pass a "loaders" object in the context when instantiating an entity, ' +
        'or override the default "entityLoader" getter with your own logic.'
      )
    }

    const loader = this.context.loaders[this.entityType]

    if (!loader) {
      throw new Error(
        `No loaders is defined for proxy ${this.entityType}. ` +
        `Either make sure context.loaders.${this.entityType} is defined, ` +
        'or override the default "entityLoader" getter with your own logic.'
      )
    }

    return loader
  }

  getters.dataValues = getters.dataValues || async function() {
    if (typeof this.entityLoader.load !== 'function') {
      throw new Error(
        'The proxy entityLoader.load should be a function. ' +
        'Either make sure the "entityLoader" getter returns a dataLoader, ' +
        'or override the default "dataValues" getter with your own logic.'
      )
    }

    const dataValues = await this.entityLoader.load(this.id)

    if (!dataValues) {
      throw new Error(`Entity ${this.entityType} with id "${this.id}" does not exist.`)
    }

    return dataValues
  }

  getters.exists = getters.exists || async function() {
    try {
      await this.dataValues
      return true
    } catch (error) {
      return false
    }
  }

  methods.assertExists = methods.assertExists || async function() {
    await this.dataValues
  }

  methods.clearCache = methods.clearCache || function() {
    if (typeof this.entityLoader.clear !== 'function') {
      throw new Error(
        'The proxy entityLoader.clear should be a function. ' +
        'Either make sure the "entityLoader" getter returns a dataLoader, ' +
        'or override the default "clearCache" method with your own logic.'
      )
    }

    this._cache = {}
    this.entityLoader.clear(this.id)
  }

  return function(id, context = {}) {
    if (id === null || id === undefined) {
      throw new Error(
        'Proxy should be instantiated with an id, ' +
        `but got: ${String(id)}.`
      )
    }

    this.id = id
    this.context = context
    this.entityType = entityType
    this._cache = {}

    return new Proxy(this, {
      get: (object, property, proxy) => {
        if (property === 'then') {
          return null
        }

        if (property in object) {
          return object[property]
        }

        if (property in object.__proto__) {
          return object.__proto__[property]
        }

        if (methods[property]) {
          return methods[property].bind(proxy)
        }

        if (!getters[property]) {
          return proxy.dataValues.then((dataValues) => dataValues[property])
        }

        if (object._cache[property] === undefined) {
          object._cache[property] = getters[property].call(proxy)
        }

        return object._cache[property]
      }
    })
  }
}
