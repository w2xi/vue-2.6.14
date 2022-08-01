/* @flow */

import config from '../config'
import { initUse } from './use'
import { initMixin } from './mixin'
import { initExtend } from './extend'
import { initAssetRegisters } from './assets'
import { set, del } from '../observer/index'
import { ASSET_TYPES } from 'shared/constants'
import builtInComponents from '../components/index'
import { observe } from 'core/observer/index'

import {
  warn,
  extend,
  nextTick,
  mergeOptions,
  defineReactive
} from '../util/index'

export function initGlobalAPI (Vue: GlobalAPI) {
  // 在 Vue 上添加 config 属性
  // config
  const configDef = {}
  configDef.get = () => config
  if (process.env.NODE_ENV !== 'production') {
    configDef.set = () => {
      warn(
        'Do not replace the Vue.config object, set individual fields instead.'
      )
    }
  }
  // 在 Vue 上添加 config 属性
  Object.defineProperty(Vue, 'config', configDef)

  // exposed util methods.
  // NOTE: these are not considered part of the public API - avoid relying on
  // them unless you are aware of the risk.
  Vue.util = {
    warn,
    extend,
    mergeOptions,
    defineReactive
  }

  // 在 Vue 添加 set, delete nextTick 方法
  Vue.set = set
  Vue.delete = del
  Vue.nextTick = nextTick

  // 在 Vue 上添加 observable 方法
  // 2.6 explicit observable API
  Vue.observable = <T>(obj: T): T => {
    observe(obj)
    return obj
  };

  // 在 Vue 上添加 options 属性
  Vue.options = Object.create(null)
  // ASSET_TYPES: ['component', 'directive', 'filter']
  ASSET_TYPES.forEach(type => {
    Vue.options[type + 's'] = Object.create(null)
  });

  // this is used to identify the "base" constructor to extend all plain-object
  // components with in Weex's multi-instance scenarios.
  Vue.options._base = Vue

  // 混合 builtInComponents 属性到 Vue.options.components
  // 最终结果: Vue.options.components = { KeepAlive }
  extend(Vue.options.components, builtInComponents)

  // 在 Vue 上添加 use 方法
  initUse(Vue)
  // 在 Vue 上添加 mixin 方法
  initMixin(Vue)
  // 在 Vue 上添加 extend 方法 和 cid 属性
  initExtend(Vue)
  // 在 Vue 上添加 component, directive, filter  方法
  initAssetRegisters(Vue)
}
