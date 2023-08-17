/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  invokeWithErrorHandling,
  noop
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;
  expression: string;
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  lazy: boolean;
  sync: boolean;
  dirty: boolean;
  active: boolean;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function;
  value: any;

  constructor (
    vm: Component,                // 组件实例对象
    expOrFn: string | Function,   // 要观察的表达式
    cb: Function,                 // 当观察的表达式的值变化时的回调函数
    options?: ?Object,            // 传递的选项
    isRenderWatcher?: boolean     // 标识该观察者实例是否是渲染函数的观察者
  ) {
    this.vm = vm
    // 如果是渲染函数的观察者
    if (isRenderWatcher) {
      // _watcher 属性是在 initLifecycle 函数中初始化的，其初始化为 null 
      vm._watcher = this
    }
    // _watchers 属性是在 initState 函数中初始化的，初始值是一个空数组
    // 属于该组件实例的观察者都会被添加到组件实例的 vm._watchers 数组中
    vm._watchers.push(this)
    // options
    if (options) {
      this.deep = !!options.deep    // 用来告诉当前观察者实例对象是否是深度观测
      this.user = !!options.user    // 用来标识当前观察者实例对象是 开发者定义的(使用 watch 选项或 $watch) 还是 内部定义的
      this.lazy = !!options.lazy    // 用来标识当前观察者实例对象是否惰性求值
      this.sync = !!options.sync    // 用来告诉观察者当数据变化时是否同步求值并执行回调
      this.before = options.before  // Watcher 实例的钩子，当数据变化之后，触发更新之前，调用在创建渲染函数的观察者实例对象时传递的 before 选项
    } else {
      this.deep = this.user = this.lazy = this.sync = false
    }
    
    this.cb = cb
    this.id = ++uid // uid for batching
    // 当前 Watcher 实例是否是处于激活状态的, 默认是激活的
    this.active = true
    this.dirty = this.lazy // for lazy watchers

    // 用于解决收集重复依赖
    this.deps = []
    this.newDeps = []
    this.depIds = new Set()
    this.newDepIds = new Set()
    
    // 在生产环境下是空字符串，在非生产环境下为表达式的字符串表示
    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''
    // parse expression for getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      this.getter = parsePath(expOrFn)
      if (!this.getter) {
        this.getter = noop
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    // 保存被观察目标的值
    this.value = this.lazy
      ? undefined
      : this.get()
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   */
  get () {
    pushTarget(this)
    let value
    const vm = this.vm
    try {
      // 调用 getter 触发依赖收集 并 对被观察目标[求值]
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      if (this.deep) {
        // deep 为 true 表示深度观测
        // 将被观测属性的值 value 传递给 traverse 函数, 
        // 然后 递归地读取被观测属性的所有子属性的值 ( 触发 getter )
        // 这样被观测属性的所有子属性都将会收集到观察者, 从而达到深度观测的目的

        traverse(value)
      }
      popTarget()
      // [求值] 结束后会清空 newDepIds 和 newDeps 这两个属性的值
      // 但是被清空之前把值分别赋给了 depIds 和 deps
      this.cleanupDeps()
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   */
  addDep (dep: Dep) {
    const id = dep.id
    // 避免收集重复依赖
    // newDepIds 用来避免 [一次求值] 的过程中收集重复的依赖
    // depIds    用来避免 [多次求值] 的过程中收集重复的依赖
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      if (!this.depIds.has(id)) {
        // 真正收集观察者
        dep.addSub(this)
      }
    }
  }

  /**
   * Clean up for dependency collection.
   */
  cleanupDeps () {
    // 移除废弃的观察者 (Wacther)
    // 对上一次求值收集到的 Dep 实例对象进行遍历
    // 如果上次求值收集到的 Dep 实例对象 不在 当前这次求值所收集的 Dep 实例对象中
    // 则说明该 Dep 实例对象已经和该观察者对象不存在依赖关系了
    // 这时候就会调用 dep.removeSub(this) 方法, 从而将该观察者对象从 Dep 实例对象中移除
    let i = this.deps.length
    while (i--) {
      const dep = this.deps[i]
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
    // 最终结果:
    // newDepIds 和 newDeps 被清空
    // 但是被清空之前把值分别赋给了 depIds 和 deps, 即:
    // depIds = newDepIds
    // deps   = newDeps

    // 结论:
    // newDepIds 和 newDeps 存储的总是当次求值所收集到的 Dep 实例对象
    // depIds 和 deps 存储的总是上一次求值过程中所收集到的 Dep 实例对象

    // 引用类型变量交换
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    this.newDepIds.clear()
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  update () {
    /* istanbul ignore else */
    if (this.lazy) {
      this.dirty = true
    } else if (this.sync) {
      // 同步执行观察者
      this.run()
    } else {
      // 将观察者放到一个队列中等待所有突变完成之后统一执行更新
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   */
  run () {
    if (this.active) {
      // 重新求值
      // 1.对于渲染函数的观察者:
      //  重新求值其实等价于重新执行渲染函数,最终结果就是重新生成虚拟DOM并更新真实DOM,这样就完成了重新渲染的过程.
      //  这里,this.get() 的返回值其实就是 updateComponet() 的返回值, 这个值是 undefined
      // 2.对于非渲染函数的观察者

      const value = this.get()
      if (
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        isObject(value) ||
        this.deep
      ) {
        // set new value
        const oldValue = this.value
        this.value = value
        // this.user 为真 意味着观察者是开发者定义的, 即通过 watch 选项或 $watch 函数定义的观察者
        // 这些观察者的特点就是回调函数是由开发者编写的, 意味着回调函数的执行是不可预知的
        if (this.user) {
          const info = `callback for watcher "${this.expression}"`
          invokeWithErrorHandling(this.cb, this.vm, [value, oldValue], this.vm, info)
        } else {
          // 执行观察者的回调函数
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   */
  evaluate () {
    this.value = this.get()
    this.dirty = false
  }

  /**
   * Depend on all deps collected by this watcher.
   */
  depend () {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }

  /**
   * 将自身 watcher 实例从所有 依赖的订阅者列表中 移除
   * Remove self from all dependencies' subscriber list.
   */
  teardown () {
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.

      // 每个组件实例都有一个 vm._isBeingDestroyed 属性( 定义在 lifecycle.js 文件的 initLifecycle 函数中 ) 
      // 用来标识该组件实例是否已经被销毁

      if (!this.vm._isBeingDestroyed) {
        // 将当前 观察者实例对象 从 组件实例对象的 vm._watchers 数组中移除
        remove(this.vm._watchers, this)
      }
      // 将当前观察者实例对象从所有的 Dep 实例对象中移除
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      this.active = false
    }
  }
}
