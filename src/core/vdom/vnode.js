/* @flow */

// 元素节点
// example: <p><span>Hello </span><span>Berwin</span></p>
// 对应的 vnode:
// {
//   children: [VNode, VNode],
//   context: {...},
//   data: {...},
//   tag: 'p',
// }

export default class VNode {
  tag: string | void;
  data: VNodeData | void;
  children: ?Array<VNode>;
  text: string | void;
  elm: Node | void;
  ns: string | void;
  context: Component | void; // rendered in this component's scope
  key: string | number | void;
  componentOptions: VNodeComponentOptions | void;
  componentInstance: Component | void; // component instance
  parent: VNode | void; // component placeholder node

  // strictly internal
  raw: boolean; // contains raw HTML? (server only)
  isStatic: boolean; // hoisted static node
  isRootInsert: boolean; // necessary for enter transition check
  isComment: boolean; // empty comment placeholder?
  isCloned: boolean; // is a cloned node?
  isOnce: boolean; // is a v-once node?
  asyncFactory: Function | void; // async component factory function
  asyncMeta: Object | void;
  isAsyncPlaceholder: boolean;
  ssrContext: Object | void;
  fnContext: Component | void; // real context vm for functional nodes
  fnOptions: ?ComponentOptions; // for SSR caching
  devtoolsMeta: ?Object; // used to store functional render context for devtools
  fnScopeId: ?string; // functional scope id support

  constructor (
    tag?: string,
    data?: VNodeData,
    children?: ?Array<VNode>,
    text?: string,
    elm?: Node,
    context?: Component,
    componentOptions?: VNodeComponentOptions,
    asyncFactory?: Function
  ) {
    this.tag = tag                                // 当前节点的标签名
    this.data = data                              // 当前节点的数据
    this.children = children                      // 当前节点的子节点
    this.text = text                              // 当前节点的文本
    this.elm = elm                                // 当前节点对应的真实 DOM
    this.ns = undefined                           // 当前节点的命名空间
    this.context = context                        // 当前节点的编译作用域
    this.fnContext = undefined
    this.fnOptions = undefined
    this.fnScopeId = undefined
    this.key = data && data.key                   // 当前节点的 key 属性
    this.componentOptions = componentOptions      // 组件的 options 选项对象
    this.componentInstance = undefined            // 当前节点对应的组件实例对象
    this.parent = undefined                       // 当前节点的父节点
    this.raw = false                              // 是否是原生 html
    this.isStatic = false                         // 是否是静态节点
    this.isRootInsert = true                      // 是否作为根节点插入
    this.isComment = false                        // 是否是注释节点
    this.isCloned = false                         // 是否是克隆节点
    this.isOnce = false                           // 是否有 v-once 指令
    this.asyncFactory = asyncFactory
    this.asyncMeta = undefined
    this.isAsyncPlaceholder = false
  }

  // DEPRECATED: alias for componentInstance for backwards compat.
  /* istanbul ignore next */
  get child (): Component | void {
    return this.componentInstance
  }
}

// 注释节点
// example: <!-- 注释节点 -->
// { text: '注释节点', isComment: true }
export const createEmptyVNode = (text: string = '') => {
  const node = new VNode()
  node.text = text
  node.isComment = true
  return node
}

// 文本节点 (除了 text 属性, 其余属性全是默认的 undefined 或 false)
// example: content
// { text: 'content' }
export function createTextVNode (val: string | number) {
  return new VNode(undefined, undefined, undefined, String(val))
}

// 克隆节点
// 将现有节点的属性复制到新节点中,让新创建的节点和被克隆节点的属性保持一致,从而实现克隆效果.
// 它的作用是优化静态节点和插槽节点(slot node).
// 以静态节点为例,当组件内的某个状态发生变化后,当前组件会通过虚拟DOM重新渲染视图,静态节点因为它的内容不会改变,
// 所以除了首次渲染需要执行渲染函数获取vnode之外,后续更新不需要执行渲染函数重新生成vnode.
// 因此,这时就会使用创建克隆节点的方法将vnode克隆一份,使用克隆节点进行渲染.
// 这样就不需要重新执行渲染函数生成新的静态节点的vnode,从而提升一定程度的性能
//                                                            ---- <<Vue.js 深入浅出>>  by Berwin

// optimized shallow clone
// used for static nodes and slot nodes because they may be reused across
// multiple renders, cloning them avoids errors when DOM manipulations rely
// on their elm reference.
export function cloneVNode (vnode: VNode): VNode {
  const cloned = new VNode(
    vnode.tag,
    vnode.data,
    // #7975
    // clone children array to avoid mutating original in case of cloning
    // a child.
    vnode.children && vnode.children.slice(),
    vnode.text,
    vnode.elm,
    vnode.context,
    vnode.componentOptions,
    vnode.asyncFactory
  )
  cloned.ns = vnode.ns
  cloned.isStatic = vnode.isStatic
  cloned.key = vnode.key
  cloned.isComment = vnode.isComment
  cloned.fnContext = vnode.fnContext
  cloned.fnOptions = vnode.fnOptions
  cloned.fnScopeId = vnode.fnScopeId
  cloned.asyncMeta = vnode.asyncMeta
  cloned.isCloned = true
  return cloned
}
