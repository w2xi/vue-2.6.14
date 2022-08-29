/* @flow */

import { hasOwn } from 'shared/util'
import { warn, hasSymbol } from '../util/index'
import { defineReactive, toggleObserving } from '../observer/index'

export function initProvide (vm: Component) {
  const provide = vm.$options.provide
  if (provide) {
    vm._provided = typeof provide === 'function'
      ? provide.call(vm)
      : provide
  }
}

export function initInjections (vm: Component) {
  // 我们知道子组件中通过 inject 选项注入的数据其实是存放在其父代组件实例的 vm._provided 属性中
  // resolveInject 函数的作用就是根据当前组件的 inject 选项去父代组件中寻找注入的数据, 并将最终的数据返回
  const result = resolveInject(vm.$options.inject, vm)
  if (result) {
    toggleObserving(false)
    Object.keys(result).forEach(key => {
      /* istanbul ignore else */
      if (process.env.NODE_ENV !== 'production') {
        // 非生产环境下, 修改 injectd 值 会打印警告信息
        defineReactive(vm, key, result[key], () => {
          warn(
            `Avoid mutating an injected value directly since the changes will be ` +
            `overwritten whenever the provided component re-renders. ` +
            `injection being mutated: "${key}"`,
            vm
          )
        })
      } else {
        // 在当前组件实例上定义 inject 中同名的 key
        defineReactive(vm, key, result[key])
      }
    })
    toggleObserving(true)
  }
}

export function resolveInject (inject: any, vm: Component): ?Object {
  if (inject) {
    // inject is :any because flow is not smart enough to figure out cached
    const result = Object.create(null)
    // 注意, Reflect.ownKeys(inject): 获取对象自身的属性, 包括不可枚举的属性, 比如可能的属性: `__ob__`
    const keys = hasSymbol
      ? Reflect.ownKeys(inject)
      : Object.keys(inject)

    // 假设 inject 选项: ['data1']
    // inject 选项被规范化后: { data1: { from: 'data1' } }
    // 更具体的可以查看 src/core/util/options.js 文件中的 normalizeInject 函数对 inject 选项的规范化

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]
      // #6574 in case the inject object is observed...
      if (key === '__ob__') continue
      const provideKey = inject[key].from
      // 当前组件实例对象
      let source = vm
      // 我们知道 inject 选项的初始化是在 provide 选项初始化之前的
      // 即使当前组件 vm.$options.provide 选项提供的数据中存在 inject 选项注入的数据
      // 也不会有任何影响，因为 vm._provided 此时为 undefined, 即不可能存在 `自身给自身注入`数据的情况.
      // 【结论】: 当一个组件使用 provide 提供数据时，该数据只有子代组件可用. 
      while (source) {
        if (source._provided && hasOwn(source._provided, provideKey)) {
          result[key] = source._provided[provideKey]
          // 退出 while 循环
          break
        }
        source = source.$parent
      }
      // 我们知道 根组件实例 vm.$parent = null
      // 如果一直找到根组件实例还没有找到数据, 那么 source = null
      // 即进入下面的 if 语句
      if (!source) {
        // 查看 inject[key] 中是否定义了 default 选项
        if ('default' in inject[key]) {
          // 使用 default 选项提供的数据作为注入的数据
          const provideDefault = inject[key].default
          result[key] = typeof provideDefault === 'function'
            ? provideDefault.call(vm)
            : provideDefault
        } else if (process.env.NODE_ENV !== 'production') {
          // 非生产环境下，提示开发者 未找到注入的数据
          warn(`Injection "${key}" not found`, vm)
        }
      }
    }
    return result
  }
}
