// 从五个文件导入五个方法（不包括 warn）
import { initMixin } from './init'
import { stateMixin } from './state'
import { renderMixin } from './render'
import { eventsMixin } from './events'
import { lifecycleMixin } from './lifecycle'
import { warn } from '../util/index'

// 定义 Vue 构造函数
function Vue (options) {
  if (process.env.NODE_ENV !== 'production' &&
    !(this instanceof Vue)
  ) {
    warn('Vue is a constructor and should be called with the `new` keyword')
  }
  this._init(options)
}

// 将 Vue 作为参数传递给导入的五个方法
// 在 Vue.prototype 上添加属性和方法

// 定义了 _init 方法，用于 Vue 构造函数内部的初始化操作
initMixin(Vue)
// 定义了:
// 属性：$data (代理 _data), $props (代理 _props) 只读属性
// 方法: $set, $del, $watch
stateMixin(Vue)
// 定义了 $on, $once, $off, $emit 四个方法
eventsMixin(Vue)
// 定义了 _update, $forceUpdate, $destroy 三个方法
lifecycleMixin(Vue)
// 定义了 $nextTick, _render 等方法
renderMixin(Vue)

// 导出 Vue
export default Vue
