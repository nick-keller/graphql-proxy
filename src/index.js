export const createProxy = ({ entityType, getters = {}, methods = {}, } = {}) => {
  getters.entityLoader = getters.entityLoader || function() {
    return this.context.loaders[this.entityType]
  }

  getters.dataValues = getters.dataValues || async function() {
    const dataValues = await this.entityLoader.load(this.id)

    if (!dataValues) {
      throw new Error(`Entity ${this.entityType} with id "${this.id}" does not exist`)
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
    this._cache = {}
    this.entityLoader.clear(this.id)
  }

  return function(id, context) {
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
