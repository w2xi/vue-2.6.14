/* @flow */

import { toArray } from '../util/index'

export function initUse (Vue: GlobalAPI) {
  Vue.use = function (plugin: Function | Object) {
    const installedPlugins = (this._installedPlugins || (this._installedPlugins = []))
    if (installedPlugins.indexOf(plugin) > -1) {
      // 如果插件已经被安装过, 则无需再安装, 直接返回 Vue
      return this
    }

    // additional parameters
    const args = toArray(arguments, 1)
    // 把 Vue 作为 args 的第一个参数
    args.unshift(this)
    if (typeof plugin.install === 'function') {
      // 插件对象有 install 方法, 则调用 install 方法
      plugin.install.apply(plugin, args)
    } else if (typeof plugin === 'function') {
      // 如果插件是函数, 则调用该函数
      plugin.apply(null, args)
    }
    // 添加已安装的插件数组中
    installedPlugins.push(plugin)
    return this
  }
}
