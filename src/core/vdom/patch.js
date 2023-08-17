/**
 * Virtual DOM patching algorithm based on Snabbdom by
 * Simon Friis Vindum (@paldepind)
 * Licensed under the MIT License
 * https://github.com/paldepind/snabbdom/blob/master/LICENSE
 *
 * modified by Evan You (@yyx990803)
 *
 * Not type-checking this because this file is perf-critical and the cost
 * of making flow understand it is not worth it.
 */

import VNode, { cloneVNode } from './vnode'
import config from '../config'
import { SSR_ATTR } from 'shared/constants'
import { registerRef } from './modules/ref'
import { traverse } from '../observer/traverse'
import { activeInstance } from '../instance/lifecycle'
import { isTextInputType } from 'web/util/element'

import {
  warn,
  isDef,
  isUndef,
  isTrue,
  makeMap,
  isRegExp,
  isPrimitive
} from '../util/index'

export const emptyNode = new VNode('', {}, [])

const hooks = ['create', 'activate', 'update', 'remove', 'destroy']

// 检测两个节点是否相同
function sameVnode (a, b) {
  return (
    a.key === b.key &&
    a.asyncFactory === b.asyncFactory && (
      (
        a.tag === b.tag &&
        a.isComment === b.isComment &&
        isDef(a.data) === isDef(b.data) &&
        sameInputType(a, b)
      ) || (
        isTrue(a.isAsyncPlaceholder) &&
        isUndef(b.asyncFactory.error)
      )
    )
  )
}

function sameInputType (a, b) {
  if (a.tag !== 'input') return true
  let i
  const typeA = isDef(i = a.data) && isDef(i = i.attrs) && i.type
  const typeB = isDef(i = b.data) && isDef(i = i.attrs) && i.type
  return typeA === typeB || isTextInputType(typeA) && isTextInputType(typeB)
}

/**
 * 得到指定范围（beginIdx —— endIdx）内节点的 key 和 索引之间的关系映射 => { key1: idx1, ... }
 */
function createKeyToOldIdx (children, beginIdx, endIdx) {
  let i, key
  const map = {}
  for (i = beginIdx; i <= endIdx; ++i) {
    key = children[i].key
    if (isDef(key)) map[key] = i
  }
  return map
}

// patch 方法的工厂函数, 为其传入平台特有的一些操作, 并返回一个 patch 函数
// backend: { nodeOps, modules }
//  nodeOps: 提供了 web 平台的 DOM 操作 API
//  modules: 提供了平台特有的一些操作, 比如：attr、class、style、events 等
export function createPatchFunction (backend) {
  let i, j
  const cbs = {}

  const { modules, nodeOps } = backend

  // 遍历这些钩子，然后从 modules 的各个模块中找到相应的方法
  // 然后在合适的时间调用相应的钩子方法完成对应的操作
  for (i = 0; i < hooks.length; ++i) {
    cbs[hooks[i]] = []
    for (j = 0; j < modules.length; ++j) {
      if (isDef(modules[j][hooks[i]])) {
        cbs[hooks[i]].push(modules[j][hooks[i]])
      }
    }
  }
  // cbs = {
  //   activate: [f],
  //   create: [f, f, f, f, f, f, f, f],
  //   destroy: [f, f, f],
  //   remove: [f],
  //   update: [f, f, f, f, f, f, f],
  // }

  // 为元素 elm 创建一个空的 vnode
  function emptyNodeAt (elm) {
    return new VNode(nodeOps.tagName(elm).toLowerCase(), {}, [], undefined, elm)
  }

  function createRmCb (childElm, listeners) {
    function remove () {
      if (--remove.listeners === 0) {
        removeNode(childElm)
      }
    }
    remove.listeners = listeners
    return remove
  }
  
  // 删除指定元素节点
  function removeNode (el) {
    const parent = nodeOps.parentNode(el)
    // element may have already been removed due to v-html / v-text
    if (isDef(parent)) {
      nodeOps.removeChild(parent, el)
    }
  }

  function isUnknownElement (vnode, inVPre) {
    return (
      !inVPre &&
      !vnode.ns &&
      !(
        config.ignoredElements.length &&
        config.ignoredElements.some(ignore => {
          return isRegExp(ignore)
            ? ignore.test(vnode.tag)
            : ignore === vnode.tag
        })
      ) &&
      config.isUnknownElement(vnode.tag)
    )
  }

  let creatingElmInVPre = 0

  // 基于 vnode 创建整棵 DOM 树, 并插入到父节点上
  function createElm (
    vnode,
    insertedVnodeQueue,
    parentElm,
    refElm,
    nested,
    ownerArray,
    index
  ) {
    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // This vnode was used in a previous render!
      // now it's used as a new node, overwriting its elm would cause
      // potential patch errors down the road when it's used as an insertion
      // reference node. Instead, we clone the node on-demand before creating
      // associated DOM element for it.
      vnode = ownerArray[index] = cloneVNode(vnode)
    }

    // 是否作为根节点插入
    vnode.isRootInsert = !nested // for transition enter check
    /**
     * 重点
     * 1. 如果 vnode 是一个组件, 则执行 init 钩子, [实例化组件] 并 [挂载组件],
     *      然后为组件执行各个模块的 create 钩子
     *      如果组件被 keep-alive 包裹，则激活组件
     * 2. 如果是一个普通元素，则什么也不错
     */
    if (createComponent(vnode, insertedVnodeQueue, parentElm, refElm)) {
      return
    }

    const data = vnode.data
    // vnode 的子节点
    const children = vnode.children
    // 当前节点标签名
    const tag = vnode.tag
    if (isDef(tag)) {                     // 元素节点
      if (process.env.NODE_ENV !== 'production') {
        if (data && data.pre) {
          creatingElmInVPre++
        }
        if (isUnknownElement(vnode, creatingElmInVPre)) {
          // 未知元素
          warn(
            'Unknown custom element: <' + tag + '> - did you ' +
            'register the component correctly? For recursive components, ' +
            'make sure to provide the "name" option.',
            vnode.context
          )
        }
      }

      // 创建 DOM 元素节点
      vnode.elm = vnode.ns
        ? nodeOps.createElementNS(vnode.ns, tag)
        : nodeOps.createElement(tag, vnode)
      setScope(vnode)

      /* istanbul ignore if */
      if (__WEEX__) {
        // in Weex, the default insertion order is parent-first.
        // List items can be optimized to use children-first insertion
        // with append="tree".
        const appendAsTree = isDef(data) && isTrue(data.appendAsTree)
        if (!appendAsTree) {
          if (isDef(data)) {
            invokeCreateHooks(vnode, insertedVnodeQueue)
          }
          insert(parentElm, vnode.elm, refElm)
        }
        createChildren(vnode, children, insertedVnodeQueue)
        if (appendAsTree) {
          if (isDef(data)) {
            invokeCreateHooks(vnode, insertedVnodeQueue)
          }
          insert(parentElm, vnode.elm, refElm)
        }
      } else {
        // 递归创建子节点
        // vnode 节点的 children 属性保存了当前节点的所有子虚拟节点 (child virtual node)
        createChildren(vnode, children, insertedVnodeQueue)
        if (isDef(data)) {
          invokeCreateHooks(vnode, insertedVnodeQueue)
        }
        // 将当前元素节点插入到父元素节点
        // 当 createChildren 递归结束, vnode.elm 上形成了一颗完整的 DOM 树( 还未被插入到视图, 处于游离状态 )
        // 此时, 将该 DOM 树插入到 父元素节点中
        insert(parentElm, vnode.elm, refElm)
      }

      if (process.env.NODE_ENV !== 'production' && data && data.pre) {
        creatingElmInVPre--
      }
    } else if (isTrue(vnode.isComment)) { // 注释节点
      // 创建注释节点并插入父元素节点
      vnode.elm = nodeOps.createComment(vnode.text)
      insert(parentElm, vnode.elm, refElm)
    } else {                              // 文本节点
      // 创建文本节点并插入父元素节点
      vnode.elm = nodeOps.createTextNode(vnode.text)
      insert(parentElm, vnode.elm, refElm)
    }
  }

  /**
   * 如果 vnode 是一个组件，则执行 init 钩子，创建组件实例，并挂载. 
   * 然后为组件执行各个模块的 create 方法
   * @param {*} vnode 组件新的 vnode
   * @param {*} insertedVnodeQueue 数组
   * @param {*} parentElm oldVnode 的父节点
   * @param {*} refElm oldVnode 的下一个兄弟节点
   * @returns 如果 vnode 是一个组件并且组件创建成功，则返回 true，否则什么也不做, 直接返回 undefined
   */
  function createComponent (vnode, insertedVnodeQueue, parentElm, refElm) {
    let i = vnode.data
    if (isDef(i)) {
      // 检测组件实例是否存在 && 被 keep-alive 包裹
      const isReactivated = isDef(vnode.componentInstance) && i.keepAlive
      if (isDef(i = i.hook) && isDef(i = i.init)) {
        // 调用 init 钩子函数 ( ./create-component.js )
        i(vnode, false /* hydrating */)
      }
      // after calling the init hook, if the vnode is a child component
      // it should've created a child instance and mounted it. the child
      // component also has set the placeholder vnode's elm.
      // in that case we can just return the element and be done.
      if (isDef(vnode.componentInstance)) {
        // 如果 vnode 是一个子组件，则调用 init 钩子之后会创建一个组件实例，并挂载
        // 这时候就可以给组件执行各个模块的的 create 钩子了
        initComponent(vnode, insertedVnodeQueue)
        // 将组件的 DOM 节点插入到父节点内
        insert(parentElm, vnode.elm, refElm)
        if (isTrue(isReactivated)) {
          // 组件被 keep-alive 包裹的情况，激活组件
          reactivateComponent(vnode, insertedVnodeQueue, parentElm, refElm)
        }
        return true
      }
    }
  }

  function initComponent (vnode, insertedVnodeQueue) {
    if (isDef(vnode.data.pendingInsert)) {
      insertedVnodeQueue.push.apply(insertedVnodeQueue, vnode.data.pendingInsert)
      vnode.data.pendingInsert = null
    }
    vnode.elm = vnode.componentInstance.$el
    if (isPatchable(vnode)) {
      invokeCreateHooks(vnode, insertedVnodeQueue)
      setScope(vnode)
    } else {
      // empty component root.
      // skip all element-related modules except for ref (#3455)
      registerRef(vnode)
      // make sure to invoke the insert hook
      insertedVnodeQueue.push(vnode)
    }
  }

  function reactivateComponent (vnode, insertedVnodeQueue, parentElm, refElm) {
    let i
    // hack for #4339: a reactivated component with inner transition
    // does not trigger because the inner node's created hooks are not called
    // again. It's not ideal to involve module-specific logic in here but
    // there doesn't seem to be a better way to do it.
    let innerNode = vnode
    while (innerNode.componentInstance) {
      innerNode = innerNode.componentInstance._vnode
      if (isDef(i = innerNode.data) && isDef(i = i.transition)) {
        for (i = 0; i < cbs.activate.length; ++i) {
          cbs.activate[i](emptyNode, innerNode)
        }
        insertedVnodeQueue.push(innerNode)
        break
      }
    }
    // unlike a newly created component,
    // a reactivated keep-alive component doesn't insert itself
    insert(parentElm, vnode.elm, refElm)
  }

  /**
   * 向父节点插入节点
   */
  function insert (parent, elm, ref) {
    if (isDef(parent)) {
      if (isDef(ref)) {
        if (nodeOps.parentNode(ref) === parent) {
          nodeOps.insertBefore(parent, elm, ref)
        }
      } else {
        nodeOps.appendChild(parent, elm)
      }
    }
  }

  /**
   * 创建子节点, 并将子节点插入父节点, 形成一棵 DOM 树
   */
  function createChildren (vnode, children, insertedVnodeQueue) {
    if (Array.isArray(children)) {        // children 是数组, 表示是一组节点
      if (process.env.NODE_ENV !== 'production') {
        // 检测这组节点的 key 是否重复
        checkDuplicateKeys(children)
      }
      // 遍历子节点, 依次创建这些子节点然后插入到父节点, 形成一棵 DOM 树
      for (let i = 0; i < children.length; ++i) {
        createElm(children[i], insertedVnodeQueue, vnode.elm, null, true, children, i)
      }
    } else if (isPrimitive(vnode.text)) { // 文本节点
      // 创建文本节点, 并插入到父节点
      nodeOps.appendChild(vnode.elm, nodeOps.createTextNode(String(vnode.text)))
    }
  }

  function isPatchable (vnode) {
    while (vnode.componentInstance) {
      vnode = vnode.componentInstance._vnode
    }
    return isDef(vnode.tag)
  }

  /**
   * 调用 各个模块的 create 方法，比如创建属性的、创建样式的、事件的、指令的等等，然后执行组件的 mounted 生命周期方法
   */
  function invokeCreateHooks (vnode, insertedVnodeQueue) {
    for (let i = 0; i < cbs.create.length; ++i) {
      cbs.create[i](emptyNode, vnode)
    }
    // 当前 vnode 节点的 hook
    i = vnode.data.hook // Reuse variable
    if (isDef(i)) {
      // 如果 hook 有  create 钩子
      if (isDef(i.create)) i.create(emptyNode, vnode)
      // 如果 hook 有 insert 钩子
      if (isDef(i.insert)) insertedVnodeQueue.push(vnode)
    }
  }

  // set scope id attribute for scoped CSS.
  // this is implemented as a special case to avoid the overhead
  // of going through the normal attribute patching process.
  function setScope (vnode) {
    let i
    if (isDef(i = vnode.fnScopeId)) {
      nodeOps.setStyleScope(vnode.elm, i)
    } else {
      let ancestor = vnode
      while (ancestor) {
        if (isDef(i = ancestor.context) && isDef(i = i.$options._scopeId)) {
          nodeOps.setStyleScope(vnode.elm, i)
        }
        ancestor = ancestor.parent
      }
    }
    // for slot content they should also get the scopeId from the host instance.
    if (isDef(i = activeInstance) &&
      i !== vnode.context &&
      i !== vnode.fnContext &&
      isDef(i = i.$options._scopeId)
    ) {
      nodeOps.setStyleScope(vnode.elm, i)
    }
  }

  /**
   * 在指定索引范围（startIdx —— endIdx）内添加节点
   */
  function addVnodes (parentElm, refElm, vnodes, startIdx, endIdx, insertedVnodeQueue) {
    for (; startIdx <= endIdx; ++startIdx) {
      createElm(vnodes[startIdx], insertedVnodeQueue, parentElm, refElm, false, vnodes, startIdx)
    }
  }

  /**
   * 销毁节点：
   *   调用组件的 destroy 钩子，即调用 $destroy 方法 
   *   调用组件各个模块(style、class、directive 等）的 destroy 方法
   *   如果 vnode 还存在子节点，则递归调用 invokeDestroyHook
   */
  function invokeDestroyHook (vnode) {
    let i, j
    const data = vnode.data
    if (isDef(data)) {
      // 调用 destroy 钩子函数 ( ./create-component.js )
      if (isDef(i = data.hook) && isDef(i = i.destroy)) i(vnode)
      // 调用组件各个模块(ref, directive, events)的 destroy 方法
      for (i = 0; i < cbs.destroy.length; ++i) cbs.destroy[i](vnode)
    }
    if (isDef(i = vnode.children)) {
      // 遍历 children, 递归执行
      for (j = 0; j < vnode.children.length; ++j) {
        invokeDestroyHook(vnode.children[j])
      }
    }
  }

  /**
   * 移除指定索引范围（startIdx —— endIdx）内的节点 
   */
  function removeVnodes (vnodes, startIdx, endIdx) {
    for (; startIdx <= endIdx; ++startIdx) {
      const ch = vnodes[startIdx]
      if (isDef(ch)) {
        if (isDef(ch.tag)) {
          removeAndInvokeRemoveHook(ch)
          invokeDestroyHook(ch)
        } else { // Text node
          // 删除视图中的单个元素节点
          removeNode(ch.elm)
        }
      }
    }
  }

  function removeAndInvokeRemoveHook (vnode, rm) {
    if (isDef(rm) || isDef(vnode.data)) {
      let i
      const listeners = cbs.remove.length + 1
      if (isDef(rm)) {
        // we have a recursively passed down rm callback
        // increase the listeners count
        rm.listeners += listeners
      } else {
        // directly removing
        rm = createRmCb(vnode.elm, listeners)
      }
      // recursively invoke hooks on child component root node
      if (isDef(i = vnode.componentInstance) && isDef(i = i._vnode) && isDef(i.data)) {
        removeAndInvokeRemoveHook(i, rm)
      }
      for (i = 0; i < cbs.remove.length; ++i) {
        cbs.remove[i](vnode, rm)
      }
      if (isDef(i = vnode.data.hook) && isDef(i = i.remove)) {
        i(vnode, rm)
      } else {
        rm()
      }
    } else {
      removeNode(vnode.elm)
    }
  }

  /**
   * diff 过程 ( 更新子节点 ):
   * 大概分为 4 种操作: 更新节点, 新增节点, 删除节点, 移动节点.
   */
  function updateChildren (parentElm, oldCh, newCh, insertedVnodeQueue, removeOnly) {
    let oldStartIdx = 0
    let newStartIdx = 0
    let oldEndIdx = oldCh.length - 1
    let oldStartVnode = oldCh[0]
    let oldEndVnode = oldCh[oldEndIdx]
    let newEndIdx = newCh.length - 1
    let newStartVnode = newCh[0]
    let newEndVnode = newCh[newEndIdx]
    let oldKeyToIdx, idxInOld, vnodeToMove, refElm

    // 只有在 <transition-group> 组件中 remvoeOnly 为 true, 其他情况都为 false
    // removeOnly is a special flag used only by <transition-group>
    // to ensure removed elements stay in correct relative positions
    // during leaving transitions
    const canMove = !removeOnly

    if (process.env.NODE_ENV !== 'production') {
      checkDuplicateKeys(newCh)
    }

    // 在 while 循环的一开始先判断了 oldStartVnode 和 oldEndVnode 是否存在, 
    // 如果不存在, 则直接跳过这个节点,处理下一个节点.
    // 之所以有这么一个判断,主要是为了处理旧节点已经被移动到其他位置的情况.移动节点时,真正移动的是真实的DOM.
    // 移动真实DOM节点后,为了防止后续重复处理同一个节点, 旧的虚拟子节点就会被设置为 undefined, 
    // 用来标记这个节点已经被处理并且移动到其他位置.

    // 优化策略 
    // 快速地比较两个节点的方式 ( 提升性能 )
    // 新前: newChildren 中所有未处理的第一个节点      newStartVnode
    // 新后: newChildren 中所有未处理的最后一个节点    newEndVnode
    // 旧前: oldChildren 中所有未处理的第一个节点      oldStartVnode
    // 旧后: oldChildren 中所有未处理的最后一个节点    oldEndVnode

    // 如果以上4种对比方式都没有匹配上, 最后再使用循环遍历来查找节点

    while (oldStartIdx <= oldEndIdx && newStartIdx <= newEndIdx) {
      if (isUndef(oldStartVnode)) {
        oldStartVnode = oldCh[++oldStartIdx] // Vnode has been moved left
      } else if (isUndef(oldEndVnode)) {
        oldEndVnode = oldCh[--oldEndIdx]
      } else if (sameVnode(oldStartVnode, newStartVnode)) { // 新前和旧前
        patchVnode(oldStartVnode, newStartVnode, insertedVnodeQueue, newCh, newStartIdx)
        oldStartVnode = oldCh[++oldStartIdx]
        newStartVnode = newCh[++newStartIdx]
      } else if (sameVnode(oldEndVnode, newEndVnode)) {     // 新后和旧后
        patchVnode(oldEndVnode, newEndVnode, insertedVnodeQueue, newCh, newEndIdx)
        oldEndVnode = oldCh[--oldEndIdx]
        newEndVnode = newCh[--newEndIdx]
      } else if (sameVnode(oldStartVnode, newEndVnode)) { // Vnode moved right  新后和旧前
        patchVnode(oldStartVnode, newEndVnode, insertedVnodeQueue, newCh, newEndIdx)
        //【移动节点】 将 `旧前`DOM元素节点 移动到 `旧后`DOM元素节点的后面 ( oldChildren 中所有未处理节点的最后面 )
        canMove && nodeOps.insertBefore(parentElm, oldStartVnode.elm, nodeOps.nextSibling(oldEndVnode.elm))
        oldStartVnode = oldCh[++oldStartIdx]
        newEndVnode = newCh[--newEndIdx]
      } else if (sameVnode(oldEndVnode, newStartVnode)) { // Vnode moved left   新前和旧后
        patchVnode(oldEndVnode, newStartVnode, insertedVnodeQueue, newCh, newStartIdx)
        //【移动节点】将 `旧后`DOM元素节点 移动到 `旧前`DOM元素节点的前面  ( oldChildren 中所有未处理的最前面 )
        canMove && nodeOps.insertBefore(parentElm, oldEndVnode.elm, oldStartVnode.elm)
        oldEndVnode = oldCh[--oldEndIdx]
        newStartVnode = newCh[++newStartIdx]
      } else {                                              // 最后再使用循环的方式查找节点
        // 当前新子节点: 本次循环所指向的新子节点 ( newStartVnode )
        // 当前旧子节点: 本次循环所指向的旧子节点 ( oldStartVnode )
        // oldChildren: 旧子节点列表

        // 创建 oldChildren 的 key 和 index 索引对应关系
        if (isUndef(oldKeyToIdx)) oldKeyToIdx = createKeyToOldIdx(oldCh, oldStartIdx, oldEndIdx)
        // 找到当前新子节点在 oldChildren 中的位置
        idxInOld = isDef(newStartVnode.key)
          ? oldKeyToIdx[newStartVnode.key]
          : findIdxInOld(newStartVnode, oldCh, oldStartIdx, oldEndIdx)
        if (isUndef(idxInOld)) { // New element
          // 【新增节点】
          // 在 oldChildren 中没有找到和当前新子节点相同的节点, 说明【当前新子节点是新增节点】
          // 对于新增节点, 创建该节点后插入到 oldChildren 中所有未处理节点(未处理就是没有进行任何更新操作的节点)的前面
          createElm(newStartVnode, insertedVnodeQueue, parentElm, oldStartVnode.elm, false, newCh, newStartIdx)
        } else {
          // 【移动节点】
          // 在 oldChildren 中找到了和当前新子节点相同的节点, 但是位置不同.
          // 待移动的旧子节点
          vnodeToMove = oldCh[idxInOld]
          // 如果 待移动的旧子节点 和 当前新子节点 是同一个节点
          if (sameVnode(vnodeToMove, newStartVnode)) {
            // 【更新节点】
            patchVnode(vnodeToMove, newStartVnode, insertedVnodeQueue, newCh, newStartIdx)
            // 将旧虚拟子节点被设置为 undefined, 用来标记这个节点已经被处理并且移动到其他位置
            // 目的是为了 防止后续重复处理同一个节点
            oldCh[idxInOld] = undefined
            // 【移动节点】
            // 将 待移动的旧子节点 插入到 当前旧子节点 之前, 完成移动操作
            canMove && nodeOps.insertBefore(parentElm, vnodeToMove.elm, oldStartVnode.elm)
          } else {
            // 【新增节点】
            // same key but different element. treat as new element
            createElm(newStartVnode, insertedVnodeQueue, parentElm, oldStartVnode.elm, false, newCh, newStartIdx)
          }
        }
        newStartVnode = newCh[++newStartIdx]
      }
    }
    
    // 循环遍历结束
    // 如果 oldStartIdx > oldEndIdx 
    // 说明 oldChildren 的所有节点已经被遍历了一遍, 如果 newChildren 中还有剩余的节点, 说明这些节点是需要新增的节点,
    //      直接把这些节点插入到DOM中就行了.
    //      ( 下标在 newStartIdx 和 newEndIdx 之间的所有节点都是需要新增的节点 )
    // 否则,
    // 如果 oldStartIdx <= oldEndIdx 且 newStartIdx > newEndIdx
    // 说明 newChildren 的所有节点已经被遍历了一遍, 而 oldChildren 中还有剩余节点未被处理
    // 那么这些节点就是被废弃的, 需要删除的节点, 直接将这些节点从DOM中移除.
    // (下标在 oldStartIdx 和 oldEndIdx 之间的所有节点都是需要删除的节点)

    if (oldStartIdx > oldEndIdx) {
      refElm = isUndef(newCh[newEndIdx + 1]) ? null : newCh[newEndIdx + 1].elm
      //【新增节点】
      addVnodes(parentElm, refElm, newCh, newStartIdx, newEndIdx, insertedVnodeQueue)
    } else if (newStartIdx > newEndIdx) {
      //【删除节点】
      removeVnodes(oldCh, oldStartIdx, oldEndIdx)
    }
  }

  /**
   * 检查一组元素的 key 是否重复 
   */
  function checkDuplicateKeys (children) {
    const seenKeys = {}
    for (let i = 0; i < children.length; i++) {
      const vnode = children[i]
      const key = vnode.key
      if (isDef(key)) {
        if (seenKeys[key]) {
          warn(
            `Duplicate keys detected: '${key}'. This may cause an update error.`,
            vnode.context
          )
        } else {
          seenKeys[key] = true
        }
      }
    }
  }

  /**
  * 找到新节点（vnode）在老节点（oldCh）中的位置索引
  */
  function findIdxInOld (node, oldCh, start, end) {
    for (let i = start; i < end; i++) {
      const c = oldCh[i]
      if (isDef(c) && sameVnode(node, c)) return i
    }
  }

  /**
   * 更新节点
   *   全量的属性更新
   *   如果新老节点都有孩子, 则递归执行 diff
   *   如果新节点有孩子, 老节点没孩子, 则新增新节点的这些孩子节点
   *   如果老节点有孩子, 新节点没孩子, 则删除老节点的这些孩子
   *   更新文本节点
   */
  function patchVnode (
    oldVnode,
    vnode,
    insertedVnodeQueue,
    ownerArray,
    index,
    removeOnly
  ) {
    // 老节点和新节点相同, 直接返回 ( 递归的终止条件 )
    if (oldVnode === vnode) {
      return
    }

    if (isDef(vnode.elm) && isDef(ownerArray)) {
      // clone reused vnode
      vnode = ownerArray[index] = cloneVNode(vnode)
    }

    const elm = vnode.elm = oldVnode.elm

    if (isTrue(oldVnode.isAsyncPlaceholder)) {
      if (isDef(vnode.asyncFactory.resolved)) {
        hydrate(oldVnode.elm, vnode, insertedVnodeQueue)
      } else {
        vnode.isAsyncPlaceholder = true
      }
      return
    }

    // 跳过静态节点的更新
    // reuse element for static trees.
    // note we only do this if the vnode is cloned -
    // if the new node is not cloned it means the render functions have been
    // reset by the hot-reload-api and we need to do a proper re-render.
    if (isTrue(vnode.isStatic) &&
      isTrue(oldVnode.isStatic) &&
      vnode.key === oldVnode.key &&
      (isTrue(vnode.isCloned) || isTrue(vnode.isOnce))
    ) {
      // 新旧节点都是静态的而且两个节点的 key 一样, 
      // 并且新节点被 clone 了 或者 新节点有 v-once指令, 则重用这部分节点
      vnode.componentInstance = oldVnode.componentInstance
      return
    }

    let i
    const data = vnode.data
    if (isDef(data) && isDef(i = data.hook) && isDef(i = i.prepatch)) {
      // 执行组件的 prepatch 钩子
      i(oldVnode, vnode)
    }

    // 老节点的子节点
    const oldCh = oldVnode.children
    // 新节点的子节点
    const ch = vnode.children
    if (isDef(data) && isPatchable(vnode)) {
      // 调用各个模块的 update 方法, 用于更新节点的 attrs, class, style, directives 等
      for (i = 0; i < cbs.update.length; ++i) cbs.update[i](oldVnode, vnode)
      // 调用组件的 update 钩子
      if (isDef(i = data.hook) && isDef(i = i.update)) i(oldVnode, vnode)
    }
    if (isUndef(vnode.text)) {
      // 新虚拟节点无 text 属性, 说明 vnode 是一个元素节点.
      // 元素节点通常有子节点, 也就是 children 属性, 但也有可能没有子节点, 所以存在两种不同情况:
      // 1. vnode 有 children
      //  i.  oldVnode 有   children, 递归执行 diff 过程
      //  ii. oldVnode 没有 children, 说明 oldVnode 要么是一个空标签, 要么是有文本的文本节点,
      //        若是文本节点, 则清空文本, 然后将 vnode 中的 children 创建为真实的 DOM 节点并插入到视图
      // 2. vnode 没有 children
      //  i.  oldVnode 有 children, 移除 oldVnode 的 children 子节点
      //  ii. oldVnode 是 文本节点,  将文本内容置空为空节点

      if (isDef(oldCh) && isDef(ch)) {
        // #1.i 更新子节点
        if (oldCh !== ch) updateChildren(elm, oldCh, ch, insertedVnodeQueue, removeOnly)
      } else if (isDef(ch)) {
        // #1.ii
        if (process.env.NODE_ENV !== 'production') {
          checkDuplicateKeys(ch)
        }
        if (isDef(oldVnode.text)) nodeOps.setTextContent(elm, '')
        addVnodes(elm, null, ch, 0, ch.length - 1, insertedVnodeQueue)
      } else if (isDef(oldCh)) {
        // #2.i
        removeVnodes(oldCh, 0, oldCh.length - 1)
      } else if (isDef(oldVnode.text)) {
        // #2.ii
        nodeOps.setTextContent(elm, '')
      }
    } else if (oldVnode.text !== vnode.text) {
      /**
       * 新节点有 text 属性, 且 新旧 text 属性值不同
       * 那么不论之前旧节点的子节点是什么, 直接调用setTextContent方法,
       * 来将将视图中DOM节点的内容改为虚拟节点(vnode)的text属性所保存的文字
       *
       * 因为更新是以新创建的虚拟节点(vnode)为准的, 
       * 所以如果新创建的虚拟节点有文本, 那么根本就不需要关心之前旧节点中所包含的内容是什么,
       * 无论是文本还是元素节点, 这都不重要.
       */
      nodeOps.setTextContent(elm, vnode.text)
    }
    if (isDef(data)) {
      if (isDef(i = data.hook) && isDef(i = i.postpatch)) i(oldVnode, vnode)
    }
  }

  function invokeInsertHook (vnode, queue, initial) {
    // delay insert hooks for component root nodes, invoke them after the
    // element is really inserted
    if (isTrue(initial) && isDef(vnode.parent)) {
      vnode.parent.data.pendingInsert = queue
    } else {
      // 对于组件, 会执行 insert 钩子 ( 内部会执行组件的 mounted 生命周期钩子函数 )
      for (let i = 0; i < queue.length; ++i) {
        queue[i].data.hook.insert(queue[i])
      }
    }
  }

  let hydrationBailed = false
  // list of modules that can skip create hook during hydration because they
  // are already rendered on the client or has no need for initialization
  // Note: style is excluded because it relies on initial clone for future
  // deep updates (#7063).
  const isRenderedModule = makeMap('attrs,class,staticClass,staticStyle,key')

  // Note: this is a browser-only function so we can assume elms are DOM nodes.
  function hydrate (elm, vnode, insertedVnodeQueue, inVPre) {
    let i
    const { tag, data, children } = vnode
    inVPre = inVPre || (data && data.pre)
    vnode.elm = elm

    if (isTrue(vnode.isComment) && isDef(vnode.asyncFactory)) {
      vnode.isAsyncPlaceholder = true
      return true
    }
    // assert node match
    if (process.env.NODE_ENV !== 'production') {
      if (!assertNodeMatch(elm, vnode, inVPre)) {
        return false
      }
    }
    if (isDef(data)) {
      if (isDef(i = data.hook) && isDef(i = i.init)) i(vnode, true /* hydrating */)
      if (isDef(i = vnode.componentInstance)) {
        // child component. it should have hydrated its own tree.
        initComponent(vnode, insertedVnodeQueue)
        return true
      }
    }
    if (isDef(tag)) {
      if (isDef(children)) {
        // empty element, allow client to pick up and populate children
        if (!elm.hasChildNodes()) {
          createChildren(vnode, children, insertedVnodeQueue)
        } else {
          // v-html and domProps: innerHTML
          if (isDef(i = data) && isDef(i = i.domProps) && isDef(i = i.innerHTML)) {
            if (i !== elm.innerHTML) {
              /* istanbul ignore if */
              if (process.env.NODE_ENV !== 'production' &&
                typeof console !== 'undefined' &&
                !hydrationBailed
              ) {
                hydrationBailed = true
                console.warn('Parent: ', elm)
                console.warn('server innerHTML: ', i)
                console.warn('client innerHTML: ', elm.innerHTML)
              }
              return false
            }
          } else {
            // iterate and compare children lists
            let childrenMatch = true
            let childNode = elm.firstChild
            for (let i = 0; i < children.length; i++) {
              if (!childNode || !hydrate(childNode, children[i], insertedVnodeQueue, inVPre)) {
                childrenMatch = false
                break
              }
              childNode = childNode.nextSibling
            }
            // if childNode is not null, it means the actual childNodes list is
            // longer than the virtual children list.
            if (!childrenMatch || childNode) {
              /* istanbul ignore if */
              if (process.env.NODE_ENV !== 'production' &&
                typeof console !== 'undefined' &&
                !hydrationBailed
              ) {
                hydrationBailed = true
                console.warn('Parent: ', elm)
                console.warn('Mismatching childNodes vs. VNodes: ', elm.childNodes, children)
              }
              return false
            }
          }
        }
      }
      if (isDef(data)) {
        let fullInvoke = false
        for (const key in data) {
          if (!isRenderedModule(key)) {
            fullInvoke = true
            invokeCreateHooks(vnode, insertedVnodeQueue)
            break
          }
        }
        if (!fullInvoke && data['class']) {
          // ensure collecting deps for deep class bindings for future updates
          traverse(data['class'])
        }
      }
    } else if (elm.data !== vnode.text) {
      elm.data = vnode.text
    }
    return true
  }

  function assertNodeMatch (node, vnode, inVPre) {
    if (isDef(vnode.tag)) {
      return vnode.tag.indexOf('vue-component') === 0 || (
        !isUnknownElement(vnode, inVPre) &&
        vnode.tag.toLowerCase() === (node.tagName && node.tagName.toLowerCase())
      )
    } else {
      return node.nodeType === (vnode.isComment ? 8 : 3)
    }
  }

  /**
   * vm.__patch__
   *  vnode - 新节点  oldVnode - 老节点
   * 
   *  删除节点:
   *    1. vnode 不存在, oldVnode 存在, 销毁 oldVnode
   *    2. 创建节点后, 删除老节点
   *  创建节点:
   *    1. vnode 存在, oldVnode 不存在, 说明是组件的首次渲染, 使用 vnode 创建节点插入到视图 (组件)
   *    2. 如果 oldVnode 是真实元素, 则表示首次渲染, 创建新节点, 并插入 body, 然后移除老节点 (普通元素)
   *  更新节点:
   *    1. 如果 oldVnode 不是真实元素 且 新旧两个节点是同一个节点, 则表示更新阶段, 
   *        使用 patchVnode 方法, 进行更详细的对比与更新操作
   *          
   * 
   * 返回 patch 方法
   */
  return function patch (oldVnode, vnode, hydrating, removeOnly) {
    if (isUndef(vnode)) {
      // 删除节点#1
      if (isDef(oldVnode)) invokeDestroyHook(oldVnode)
      return
    }

    let isInitialPatch = false
    const insertedVnodeQueue = []

    if (isUndef(oldVnode)) {
      // 创建节点#1
      // 比如：`<Child></Child>`, 这里的 Child 组件初次渲染时就会走这儿
      // empty mount (likely as component), create new root element
      isInitialPatch = true
      // 此时, 使用 vnode 创建节点插入到视图
      createElm(vnode, insertedVnodeQueue)
    } else {
      // vnode 和 oldVnode 都存在

      // 判断 oldVnode 是否为真实元素
      const isRealElement = isDef(oldVnode.nodeType)
      if (!isRealElement && sameVnode(oldVnode, vnode)) {
        // 更新节点#1
        // patch existing root node
        patchVnode(oldVnode, vnode, insertedVnodeQueue, null, null, removeOnly)
      } else {
        // 进入这里说明: oldVnode 是真实元素 或者 oldVnode 和 vnode 不是同一个节点
        // 即, 普通元素(非组件)的首次渲染 或 

        if (isRealElement) {
          // oldVnode 是真实元素, 则表示初次渲染

          // 挂载到真实元素以及处理服务端渲染的情况
          // mounting to a real element
          // check if this is server-rendered content and if we can perform
          // a successful hydration.
          if (oldVnode.nodeType === 1 && oldVnode.hasAttribute(SSR_ATTR)) {
            oldVnode.removeAttribute(SSR_ATTR)
            hydrating = true
          }
          if (isTrue(hydrating)) {
            if (hydrate(oldVnode, vnode, insertedVnodeQueue)) {
              invokeInsertHook(vnode, insertedVnodeQueue, true)
              return oldVnode
            } else if (process.env.NODE_ENV !== 'production') {
              warn(
                'The client-side rendered virtual DOM tree is not matching ' +
                'server-rendered content. This is likely caused by incorrect ' +
                'HTML markup, for example nesting block-level elements inside ' +
                '<p>, or missing <tbody>. Bailing hydration and performing ' +
                'full client-side render.'
              )
            }
          }
          
          // 将真实元素转换为 vnode
          // either not server-rendered, or hydration failed.
          // create an empty node and replace it
          oldVnode = emptyNodeAt(oldVnode)
        }

        // 拿到老节点的真实元素
        // replacing existing element
        const oldElm = oldVnode.elm
        // 获取老元素的父元素 (body)
        const parentElm = nodeOps.parentNode(oldElm)

        /**
         * 基于 vnode 创建整棵 DOM 树并插入到 body 元素下
         * 
         *      虚拟 DOM               真实 DOM
         * 
         *       vnode                  node
         *       /   \        =>        /  \            =>    视图
         *    vnode  vnode            node node
         * 
         */
        // create new node
        createElm(
          vnode,
          insertedVnodeQueue,
          // extremely rare edge case: do not insert if old element is in a
          // leaving transition. Only happens when combining transition +
          // keep-alive + HOCs. (#4590)
          // 这里基本上可以认为传的就是 parentElm 元素
          oldElm._leaveCb ? null : parentElm,
          nodeOps.nextSibling(oldElm)
        )

        // 递归更新父占位符节点元素
        // update parent placeholder node element, recursively
        if (isDef(vnode.parent)) {
          let ancestor = vnode.parent
          const patchable = isPatchable(vnode)
          while (ancestor) {
            for (let i = 0; i < cbs.destroy.length; ++i) {
              cbs.destroy[i](ancestor)
            }
            ancestor.elm = vnode.elm
            if (patchable) {
              for (let i = 0; i < cbs.create.length; ++i) {
                cbs.create[i](emptyNode, ancestor)
              }
              // #6513
              // invoke insert hooks that may have been merged by create hooks.
              // e.g. for directives that uses the "inserted" hook.
              const insert = ancestor.data.hook.insert
              if (insert.merged) {
                // start at index 1 to avoid re-invoking component mounted hook
                for (let i = 1; i < insert.fns.length; i++) {
                  insert.fns[i]()
                }
              }
            } else {
              registerRef(ancestor)
            }
            ancestor = ancestor.parent
          }
        }

        // 移除老节点 ( 将视图中的节点删除 )
        // destroy old node
        if (isDef(parentElm)) {
          // 删除节点#2
          removeVnodes([oldVnode], 0, 0)
        } else if (isDef(oldVnode.tag)) {
          invokeDestroyHook(oldVnode)
        }
      }
    }

    invokeInsertHook(vnode, insertedVnodeQueue, isInitialPatch)
    return vnode.elm
  }
}
