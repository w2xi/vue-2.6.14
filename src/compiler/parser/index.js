/* @flow */

import he from 'he'
import { parseHTML } from './html-parser'
import { parseText } from './text-parser'
import { parseFilters } from './filter-parser'
import { genAssignmentCode } from '../directives/model'
import { extend, cached, no, camelize, hyphenate } from 'shared/util'
import { isIE, isEdge, isServerRendering } from 'core/util/env'

import {
  addProp,
  addAttr,
  baseWarn,
  addHandler,
  addDirective,
  getBindingAttr,
  getAndRemoveAttr,
  getRawBindingAttr,
  pluckModuleFunction,
  getAndRemoveAttrByRegex
} from '../helpers'
// 检测标签属性名是否是监听事件的指令
export const onRE = /^@|^v-on:/
// 检测标签属性名是否是指令
export const dirRE = process.env.VBIND_PROP_SHORTHAND
  ? /^v-|^@|^:|^\.|^#/
  : /^v-|^@|^:|^#/
// 匹配 v-for 属性的值
export const forAliasRE = /([\s\S]*?)\s+(?:in|of)\s+([\s\S]*)/
// 匹配 forAliasRE 第一个捕获组所捕获到的字符串
export const forIteratorRE = /,([^,\}\]]*)(?:,([^,\}\]]*))?$/
// 匹配 要么以字符 ( 开头，要么以字符 ) 结尾的字符串，或者两者都满足
// 在使用 forIteratorRE 正则之前，需要使用 stripParensRE 正则去掉字符串 '(item, index)' 中的左右括号
// '(item, index)'.replace(stripParensRE, '')
const stripParensRE = /^\(|\)$/g
const dynamicArgRE = /^\[.*\]$/

// 匹配指令中的参数
const argRE = /:(.*)$/
// 检测一个标签的属性是否是绑定(v-bind)
export const bindRE = /^:|^\.|^v-bind:/
const propBindRE = /^\./
// 匹配修饰符
const modifierRE = /\.[^.\]]+(?=[^\]]*$)/g
// 检测标签属性名是否是 v-slot (缩写: #) 指令
const slotRE = /^v-slot(:|$)|^#/

const lineBreakRE = /[\r\n]/
const whitespaceRE = /[ \f\t\r\n]+/g

const invalidAttributeRE = /[\s"'<>\/=]/

// HTML 字符实体的解码 (在后面将被用于对纯文本的解码)
const decodeHTMLCached = cached(he.decode)

export const emptySlotScopeToken = `_empty_`

// configurable state
export let warn: any
let delimiters
let transforms
let preTransforms
let postTransforms
let platformIsPreTag
let platformMustUseProp
let platformGetTagNamespace
let maybeComponent

export function createASTElement (
  tag: string,
  attrs: Array<ASTAttr>,
  parent: ASTElement | void
): ASTElement {
  return {
    type: 1,
    tag,
    attrsList: attrs,
    attrsMap: makeAttrsMap(attrs),
    rawAttrsMap: {},
    parent,
    children: []
  }
}

/**
 * 将模板字符串解析成 AST
 * Convert HTML string to AST.
 */
export function parse (
  template: string,
  options: CompilerOptions
): ASTElement | void {
  warn = options.warn || baseWarn

  platformIsPreTag = options.isPreTag || no
  platformMustUseProp = options.mustUseProp || no
  platformGetTagNamespace = options.getTagNamespace || no
  const isReservedTag = options.isReservedTag || no
  // 检测是否是一个 Vue 组件
  maybeComponent = (el: ASTElement) => !!(
    el.component ||
    el.attrsMap[':is'] ||
    el.attrsMap['v-bind:is'] ||
    !(el.attrsMap.is ? isReservedTag(el.attrsMap.is) : isReservedTag(el.tag))
  )
  // 中置处理
  transforms = pluckModuleFunction(options.modules, 'transformNode')
  // 前置处理
  preTransforms = pluckModuleFunction(options.modules, 'preTransformNode')
  // 后置处理
  postTransforms = pluckModuleFunction(options.modules, 'postTransformNode')

  delimiters = options.delimiters

  // 用来修正当前正在解析元素的父级
  const stack = []
  // 编译 html 字符串时是否保留标签之间的空格
  const preserveWhitespace = options.preserveWhitespace !== false
  const whitespaceOption = options.whitespace
  let root
  let currentParent
  // 标识当前解析的标签是否在拥有 v-pre 指令的标签之内
  let inVPre = false
  // 标识当前正在解析的标签是否在 <pre></pre> 标签之内
  let inPre = false
  // 用于接下来定义的 warnOnce 函数
  let warned = false
  
  // 打印一次警告信息
  function warnOnce (msg, range) {
    if (!warned) {
      warned = true
      warn(msg, range)
    }
  }

  // 每当遇到一个标签的结束标签时, 或遇到一元标签时都会调用该方法'闭合'标签
  function closeElement (element) {
    trimEndingWhitespace(element)
    if (!inVPre && !element.processed) {
      element = processElement(element, options)
    }
    // tree management
    if (!stack.length && element !== root) {
      // 上面 if 语句条件成立 说明存在多个【根元素】

      // allow root elements with v-if, v-else-if and v-else
      if (root.if && (element.elseif || element.else)) {
        // 上面 if 语句条件成立就能够保证所有根元素都是由 v-if、v-else-if、v-else 等指令控制的

        if (process.env.NODE_ENV !== 'production') {
          checkRootConstraints(element)
        }
        addIfCondition(root, {
          exp: element.elseif,
          block: element
        })
      } else if (process.env.NODE_ENV !== 'production') {
        warnOnce(
          `Component template should contain exactly one root element. ` +
          `If you are using v-if on multiple elements, ` +
          `use v-else-if to chain them instead.`,
          { start: element.start }
        )
      }
    }
    if (currentParent && !element.forbidden) {
      if (element.elseif || element.else) {
        // 当一个元素使用了 v-else-if 或 v-else 指令时，它们是不会作为父级元素子节点(children数组中)的
        // 而是会被添加到相符的使用了 v-if 指令的元素描述对象的 ifConditions 数组中
        processIfConditions(element, currentParent)
      } else {
        if (element.slotScope) {
          // scoped slot
          // keep it in the children list so that v-else(-if) conditions can
          // find it as the prev node.
          const name = element.slotTarget || '"default"'
          ;(currentParent.scopedSlots || (currentParent.scopedSlots = {}))[name] = element
        }
        // 把当前元素描述对象添加到父级元素描述对象(currentParent)的 children 数组中
        currentParent.children.push(element)
        // 将当前元素对象的 parent 属性指向父级元素对象
        element.parent = currentParent
        // 这样就建立了元素描述对象间的父子级关系
      }
    }

    // final children cleanup
    // filter out scoped slots
    element.children = element.children.filter(c => !(c: any).slotScope)
    // remove trailing whitespace node again
    trimEndingWhitespace(element)

    // check pre state
    if (element.pre) {
      inVPre = false
    }
    if (platformIsPreTag(element.tag)) {
      inPre = false
    }
    // apply post-transforms
    for (let i = 0; i < postTransforms.length; i++) {
      // 调用后置处理函数
      postTransforms[i](element, options)
    }
  }

  // 移除结束标签末尾的空格
  function trimEndingWhitespace (el) {
    // remove trailing whitespace node
    if (!inPre) {
      let lastNode
      // type: 3, 表示普通文本节点或注释节点
      while (
        (lastNode = el.children[el.children.length - 1]) &&
        lastNode.type === 3 &&
        lastNode.text === ' '
      ) {
        el.children.pop()
      }
    }
  }

  // 检测模板根元素是否符合约束条件 (模板必须有且仅有一个被渲染的根元素)
  function checkRootConstraints (el) {
    // 如果根节点标签是 `slot` 或 `template`, 会打印警告信息
    if (el.tag === 'slot' || el.tag === 'template') {
      warnOnce(
        `Cannot use <${el.tag}> as component root element because it may ` +
        'contain multiple nodes.',
        { start: el.start }
      )
    }
    // 如果根节点标签有 `v-for` 属性, 会打印警告信息
    if (el.attrsMap.hasOwnProperty('v-for')) {
      warnOnce(
        'Cannot use v-for on stateful component root element because ' +
        'it renders multiple elements.',
        el.rawAttrsMap['v-for']
      )
    }
  }

  parseHTML(template, {
    warn,
    expectHTML: options.expectHTML,
    isUnaryTag: options.isUnaryTag,
    canBeLeftOpenTag: options.canBeLeftOpenTag,
    shouldDecodeNewlines: options.shouldDecodeNewlines,
    shouldDecodeNewlinesForHref: options.shouldDecodeNewlinesForHref,
    shouldKeepComment: options.comments,
    outputSourceRange: options.outputSourceRange,
    start (tag, attrs, unary, start, end) {
      // check namespace.
      // inherit parent ns if there is one
      const ns = (currentParent && currentParent.ns) || platformGetTagNamespace(tag)

      // handle IE svg bug
      /* istanbul ignore if */
      if (isIE && ns === 'svg') {
        attrs = guardIESVGBug(attrs)
      }

      // 为当前元素(开始标签)创建描述对象
      let element: ASTElement = createASTElement(tag, attrs, currentParent)
      if (ns) {
        element.ns = ns
      }

      if (process.env.NODE_ENV !== 'production') {
        if (options.outputSourceRange) {
          element.start = start
          element.end = end
          element.rawAttrsMap = element.attrsList.reduce((cumulated, attr) => {
            cumulated[attr.name] = attr
            return cumulated
          }, {})
        }
        // 验证当前元素的属性名是否合法
        attrs.forEach(attr => {
          if (invalidAttributeRE.test(attr.name)) {
            warn(
              `Invalid dynamic argument expression: attribute names cannot contain ` +
              `spaces, quotes, <, >, / or =.`,
              {
                start: attr.start + attr.name.indexOf(`[`),
                end: attr.start + attr.name.length
              }
            )
          }
        })
      }

      // 如果当前元素是被禁止的, 并且是在非服务端渲染的情况下
      if (isForbiddenTag(element) && !isServerRendering()) {
        element.forbidden = true
        process.env.NODE_ENV !== 'production' && warn(
          'Templates should only be responsible for mapping the state to the ' +
          'UI. Avoid placing tags with side-effects in your templates, such as ' +
          `<${tag}>` + ', as they will not be parsed.',
          { start: element.start }
        )
      }

      // apply pre-transforms
      for (let i = 0; i < preTransforms.length; i++) {
        // 调用前置处理函数
        // 对当前元素(仅对input标签)描述对象做进一步处理
        element = preTransforms[i](element, options) || element
      }

      // 接下来的代码大量调用 process* 系列的函数, 
      // 其实就是在对当前元素描述对象做额外的处理, 使得该元素描述对象能更好的描述一个标签. 
      // 简单点说就是在元素描述对象上添加各种各样的具有标识作用的属性

      if (!inVPre) {
        processPre(element)
        if (element.pre) {
          inVPre = true
        }
      }

      // 检查当前元素标签是否是 pre 标签
      if (platformIsPreTag(element.tag)) {
        inPre = true
      }

      // 我们知道使用 v-pre 指令的标签及其子标签的解析行为是不一致的,
      // 编译器会跳过使用了 v-pre 指令元素及其子元素的编译工作
      if (inVPre) {
        processRawAttrs(element)
      } else if (!element.processed) {
        // 在 preTransforms 前置处理函数中可以看到, 如果当前元素是 input 元素才可能标识 processed 属性
        // 它标识着当前元素是否已经被解析过了

        // structural directives
        processFor(element)
        processIf(element)
        processOnce(element)
      }

      if (!root) {
        // 根元素
        root = element
        if (process.env.NODE_ENV !== 'production') {
          // 检查根元素是否符合要求
          checkRootConstraints(root)
        }
      }

      if (!unary) {
        // 每当遇到一个非一元标签都会将该元素的描述对象添加到 stack 数组,
        // 并且 currentParent 始终存储的是 stack 栈顶的元素, 即当前解析元素的父级
        currentParent = element
        stack.push(element)
      } else {
        // 如果当前元素是`一元标签`, 直接闭合该元素
        closeElement(element)
      }
    },

    end (tag, start, end) {
      // 当遇到一个非一元标签的结束标签时, 都会回退 currentParent 变量的值为之前的值
      // 这样我们就修正了当前正在解析的元素的父级元素
      const element = stack[stack.length - 1]
      // pop stack
      stack.length -= 1
      currentParent = stack[stack.length - 1]
      if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
        element.end = end
      }
      closeElement(element)
    },

    chars (text: string, start: number, end: number) {
      if (!currentParent) {
        if (process.env.NODE_ENV !== 'production') {
          // 1. 模板中只有文本节点
          // example: <template>1</template> (template 为抽象组件)
          // text 和 template 都为 '1'
          if (text === template) {
            warnOnce(
              'Component template requires a root element, rather than just text.',
              { start }
            )
          } else if ((text = text.trim())) {
            // 2. 文本节点在根元素的外面
            // example:
            `
            <template>
              <div>content</div>
              123
            </template>
            `
            // 当解析到文本 '123', 即 text = '123' 时, 该文本无外部根节点
            warnOnce(
              `text "${text}" outside root element will be ignored.`,
              { start }
            )
          }
        }
        // 当前文本无父节点元素, 直接返回
        return
      }
      // IE textarea placeholder bug
      /* istanbul ignore if */
      if (isIE &&
        currentParent.tag === 'textarea' &&
        currentParent.attrsMap.placeholder === text
      ) {
        return
      }
      const children = currentParent.children
      if (inPre || text.trim()) {
        text = isTextTag(currentParent) ? text : decodeHTMLCached(text)
      } else if (!children.length) {
        // remove the whitespace-only node right after an opening tag
        text = ''
      } else if (whitespaceOption) {
        if (whitespaceOption === 'condense') {
          // in condense mode, remove the whitespace node if it contains
          // line break, otherwise condense to a single space
          text = lineBreakRE.test(text) ? '' : ' '
        } else {
          text = ' '
        }
      } else {
        text = preserveWhitespace ? ' ' : ''
      }
      if (text) {
        if (!inPre && whitespaceOption === 'condense') {
          // condense consecutive whitespaces into single space
          text = text.replace(whitespaceRE, ' ')
        }
        let res
        let child: ?ASTNode
        if (!inVPre && text !== ' ' && (res = parseText(text, delimiters))) {
          // type: 2, 包含字面量(插值)表达式的文本节点
          // example: <span>text: {{ msg }} {{ content }}</span>
          child = {
            type: 2,
            expression: res.expression,
            tokens: res.tokens,
            text
          }
        } else if (text !== ' ' || !children.length || children[children.length - 1].text !== ' ') {
          // type: 3, 普通文本节点或注释节点
          child = {
            type: 3,
            text
          }
        }
        if (child) {
          if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
            child.start = start
            child.end = end
          }
          children.push(child)
        }
      }
    },
    comment (text: string, start, end) {
      // adding anything as a sibling to the root node is forbidden
      // comments should still be allowed, but ignored
      if (currentParent) {
        const child: ASTText = {
          type: 3,
          text,
          isComment: true
        }
        if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
          child.start = start
          child.end = end
        }
        currentParent.children.push(child)
      }
    }
  })
  return root
}

function processPre (el) {
  if (getAndRemoveAttr(el, 'v-pre') != null) {
    el.pre = true
  }
}

function processRawAttrs (el) {
  const list = el.attrsList
  const len = list.length
  if (len) {
    const attrs: Array<ASTAttr> = el.attrs = new Array(len)
    for (let i = 0; i < len; i++) {
      attrs[i] = {
        name: list[i].name,
        value: JSON.stringify(list[i].value)
      }
      if (list[i].start != null) {
        attrs[i].start = list[i].start
        attrs[i].end = list[i].end
      }
    }
  } else if (!el.pre) {
    // 进入这里, 这说明该元素一定是使用了 v-pre 指令的标签的子标签 且 没有任何属性
    // example:
    `<div v-pre>
      <span></span>
    </div>`
    // 标识该元素是纯的
    // non root node in pre blocks with no attributes
    el.plain = true
  }
}

export function processElement (
  element: ASTElement,
  options: CompilerOptions
) {
  processKey(element)

  // determine whether this is a plain element after
  // removing structural attributes
  element.plain = (
    !element.key &&
    !element.scopedSlots &&
    !element.attrsList.length
  )

  processRef(element)
  processSlotContent(element)
  processSlotOutlet(element)
  processComponent(element)
  for (let i = 0; i < transforms.length; i++) {
    // 调用中置处理函数
    // 处理了 style 和 class 属性
    element = transforms[i](element, options) || element
  }
  processAttrs(element)
  return element
}

// 1. key 属性不能被应用到 <template> 标签
// 2. 使用了 key 属性的标签，其元素描述对象的 el.key 属性保存着 key 属性的值

function processKey (el) {
  // 获取绑定属性的属性值
  const exp = getBindingAttr(el, 'key')
  if (exp) {
    if (process.env.NODE_ENV !== 'production') {
      if (el.tag === 'template') {
        warn(
          `<template> cannot be keyed. Place the key on real elements instead.`,
          getRawBindingAttr(el, 'key')
        )
      }
      if (el.for) {
        const iterator = el.iterator2 || el.iterator1
        const parent = el.parent
        if (iterator && iterator === exp && parent && parent.tag === 'transition-group') {
          warn(
            `Do not use v-for index as key on <transition-group> children, ` +
            `this is the same as not using keys.`,
            getRawBindingAttr(el, 'key'),
            true /* tip */
          )
        }
      }
    }
    el.key = exp
  }
}

function processRef (el) {
  const ref = getBindingAttr(el, 'ref')
  if (ref) {
    el.ref = ref
    el.refInFor = checkInFor(el)
  }
}

export function processFor (el: ASTElement) {
  let exp
  if ((exp = getAndRemoveAttr(el, 'v-for'))) {
    const res = parseFor(exp)
    if (res) {
      extend(el, res)
    } else if (process.env.NODE_ENV !== 'production') {
      warn(
        `Invalid v-for expression: ${exp}`,
        el.rawAttrsMap['v-for']
      )
    }
  }
}

type ForParseResult = {
  for: string;
  alias: string;
  iterator1?: string;
  iterator2?: string;
};

// 1. v-for="item of list"
// res = { for: 'list', alias: 'item' }
// 2. v-for="(item, index) of list"
// res = { for: 'list', alias: 'item', iterator1: 'index' }
// 3. v-for="(value, key, index) in obj"
// res = { for: 'obj', alias: 'value', iterator1: 'key', iterator2: 'index' }

export function parseFor (exp: string): ?ForParseResult {
  const inMatch = exp.match(forAliasRE)
  if (!inMatch) return
  const res = {}
  res.for = inMatch[2].trim()
  const alias = inMatch[1].trim().replace(stripParensRE, '')
  const iteratorMatch = alias.match(forIteratorRE)
  if (iteratorMatch) {
    res.alias = alias.replace(forIteratorRE, '').trim()
    res.iterator1 = iteratorMatch[1].trim()
    if (iteratorMatch[2]) {
      res.iterator2 = iteratorMatch[2].trim()
    }
  } else {
    res.alias = alias
  }
  return res
}

function processIf (el) {
  const exp = getAndRemoveAttr(el, 'v-if')
  if (exp) {
    el.if = exp
    addIfCondition(el, {
      exp: exp,
      block: el
    })
  } else {
    if (getAndRemoveAttr(el, 'v-else') != null) {
      el.else = true
    }
    const elseif = getAndRemoveAttr(el, 'v-else-if')
    if (elseif) {
      el.elseif = elseif
    }
  }
}

function processIfConditions (el, parent) {
  // 寻找当前元素的前一个元素节点
  const prev = findPrevElement(parent.children)
  if (prev && prev.if) {
    // 我们知道对于使用了 v-else-if 或 v-else 指令的元素来讲,
    // 他们的前一个元素必然需要使用相符的 v-if 指令才行
    // 如果前一个元素确实使用了 v-if 指令,
    // 那么则会调用 addIfCondition 函数将当前元素描述对象添加到前一个元素的 ifConditions 数组中
    addIfCondition(prev, {
      exp: el.elseif,
      block: el
    })
  } else if (process.env.NODE_ENV !== 'production') {
    // 打印警告信息提示开发者没有相符的使用了 v-if 指令的元素
    warn(
      `v-${el.elseif ? ('else-if="' + el.elseif + '"') : 'else'} ` +
      `used on element <${el.tag}> without corresponding v-if.`,
      el.rawAttrsMap[el.elseif ? 'v-else-if' : 'v-else']
    )
  }
}

// findPrevElement 函数只用在了 processIfConditions 函数中,
// 它的作用就是当解析器遇到一个带有 v-else-if 或 v-else 指令的元素时，
// 找到该元素的前一个元素节点 (或者说 父级元素描述对象的最后一个元素节点)
function findPrevElement (children: Array<any>): ASTElement | void {
  let i = children.length
  while (i--) {
    if (children[i].type === 1) {
      return children[i]
    } else {
      `<div>
        <div v-if="a"></div>
        aaaaa
        <p v-else-if="b"></p>
        bbbbb
        <span v-else="c"></span>
      </div>`
      // 如上代码中的文本 aaaaa 和 bbbbb 都将被忽略
      if (process.env.NODE_ENV !== 'production' && children[i].text !== ' ') {
        warn(
          `text "${children[i].text.trim()}" between v-if and v-else(-if) ` +
          `will be ignored.`,
          children[i]
        )
      }
      children.pop()
    }
  }
}

export function addIfCondition (el: ASTElement, condition: ASTIfCondition) {
  if (!el.ifConditions) {
    el.ifConditions = []
  }
  el.ifConditions.push(condition)
}

function processOnce (el) {
  const once = getAndRemoveAttr(el, 'v-once')
  if (once != null) {
    el.once = true
  }
}

// handle content being passed to a component as slot,
// e.g. <template slot="xxx">, <div slot-scope="xxx">
function processSlotContent (el) {
  let slotScope
  if (el.tag === 'template') {
    slotScope = getAndRemoveAttr(el, 'scope')
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && slotScope) {
      warn(
        `the "scope" attribute for scoped slots have been deprecated and ` +
        `replaced by "slot-scope" since 2.5. The new "slot-scope" attribute ` +
        `can also be used on plain elements in addition to <template> to ` +
        `denote scoped slots.`,
        el.rawAttrsMap['scope'],
        true
      )
    }
    el.slotScope = slotScope || getAndRemoveAttr(el, 'slot-scope')
  } else if ((slotScope = getAndRemoveAttr(el, 'slot-scope'))) {
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production' && el.attrsMap['v-for']) {
      warn(
        `Ambiguous combined usage of slot-scope and v-for on <${el.tag}> ` +
        `(v-for takes higher priority). Use a wrapper <template> for the ` +
        `scoped slot to make it clearer.`,
        el.rawAttrsMap['slot-scope'],
        true
      )
    }
    el.slotScope = slotScope
  }

  // slot="xxx"
  const slotTarget = getBindingAttr(el, 'slot')
  if (slotTarget) {
    el.slotTarget = slotTarget === '""' ? '"default"' : slotTarget
    el.slotTargetDynamic = !!(el.attrsMap[':slot'] || el.attrsMap['v-bind:slot'])
    // preserve slot as an attribute for native shadow DOM compat
    // only for non-scoped slots.
    if (el.tag !== 'template' && !el.slotScope) {
      addAttr(el, 'slot', slotTarget, getRawBindingAttr(el, 'slot'))
    }
  }

  // 2.6 v-slot syntax
  if (process.env.NEW_SLOT_SYNTAX) {
    if (el.tag === 'template') {
      // v-slot on <template>
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE)
      if (slotBinding) {
        if (process.env.NODE_ENV !== 'production') {
          if (el.slotTarget || el.slotScope) {
            warn(
              `Unexpected mixed usage of different slot syntaxes.`,
              el
            )
          }
          if (el.parent && !maybeComponent(el.parent)) {
            warn(
              `<template v-slot> can only appear at the root level inside ` +
              `the receiving component`,
              el
            )
          }
        }
        const { name, dynamic } = getSlotName(slotBinding)
        el.slotTarget = name
        el.slotTargetDynamic = dynamic
        el.slotScope = slotBinding.value || emptySlotScopeToken // force it into a scoped slot for perf
      }
    } else {
      // v-slot on component, denotes default slot
      const slotBinding = getAndRemoveAttrByRegex(el, slotRE)
      if (slotBinding) {
        if (process.env.NODE_ENV !== 'production') {
          if (!maybeComponent(el)) {
            warn(
              `v-slot can only be used on components or <template>.`,
              slotBinding
            )
          }
          if (el.slotScope || el.slotTarget) {
            warn(
              `Unexpected mixed usage of different slot syntaxes.`,
              el
            )
          }
          if (el.scopedSlots) {
            warn(
              `To avoid scope ambiguity, the default slot should also use ` +
              `<template> syntax when there are other named slots.`,
              slotBinding
            )
          }
        }
        // add the component's children to its default slot
        const slots = el.scopedSlots || (el.scopedSlots = {})
        const { name, dynamic } = getSlotName(slotBinding)
        const slotContainer = slots[name] = createASTElement('template', [], el)
        slotContainer.slotTarget = name
        slotContainer.slotTargetDynamic = dynamic
        slotContainer.children = el.children.filter((c: any) => {
          if (!c.slotScope) {
            c.parent = slotContainer
            return true
          }
        })
        slotContainer.slotScope = slotBinding.value || emptySlotScopeToken
        // remove children as they are returned from scopedSlots now
        el.children = []
        // mark el non-plain so data gets generated
        el.plain = false
      }
    }
  }
}

function getSlotName (binding) {
  let name = binding.name.replace(slotRE, '')
  if (!name) {
    if (binding.name[0] !== '#') {
      name = 'default'
    } else if (process.env.NODE_ENV !== 'production') {
      warn(
        `v-slot shorthand syntax requires a slot name.`,
        binding
      )
    }
  }
  return dynamicArgRE.test(name)
    // dynamic [name]
    ? { name: name.slice(1, -1), dynamic: true }
    // static name
    : { name: `"${name}"`, dynamic: false }
}

// handle <slot/> outlets
function processSlotOutlet (el) {
  if (el.tag === 'slot') {
    el.slotName = getBindingAttr(el, 'name')
    if (process.env.NODE_ENV !== 'production' && el.key) {
      warn(
        `\`key\` does not work on <slot> because slots are abstract outlets ` +
        `and can possibly expand into multiple elements. ` +
        `Use the key on a wrapping element instead.`,
        getRawBindingAttr(el, 'key')
      )
    }
  }
}

function processComponent (el) {
  let binding
  if ((binding = getBindingAttr(el, 'is'))) {
    el.component = binding
  }
  if (getAndRemoveAttr(el, 'inline-template') != null) {
    el.inlineTemplate = true
  }
}

function processAttrs (el) {
  const list = el.attrsList
  let i, l, name, rawName, value, modifiers, syncGen, isDynamic
  for (i = 0, l = list.length; i < l; i++) {
    name = rawName = list[i].name
    value = list[i].value
    if (dirRE.test(name)) {
      // mark element as dynamic
      el.hasBindings = true
      // 解析指令的修饰符
      // modifiers
      modifiers = parseModifiers(name.replace(dirRE, ''))
      // support .foo shorthand syntax for the .prop modifier
      if (process.env.VBIND_PROP_SHORTHAND && propBindRE.test(name)) {
        (modifiers || (modifiers = {})).prop = true
        name = `.` + name.slice(1).replace(modifierRE, '')
      } else if (modifiers) {
        // 将修饰符从指令字符串中移除 ( @click.native.prevent => @click )
        name = name.replace(modifierRE, '')
      }
      if (bindRE.test(name)) { // v-bind
        // 移除字符串中的 `v-bind:` or `:`
        name = name.replace(bindRE, '')
        value = parseFilters(value)
        // 是否是动态绑定
        // example: :[a]="b"
        isDynamic = dynamicArgRE.test(name)
        if (isDynamic) {
          name = name.slice(1, -1)
        }
        if (
          process.env.NODE_ENV !== 'production' &&
          value.trim().length === 0
        ) {
          warn(
            `The value for a v-bind expression cannot be empty. Found in "v-bind:${name}"`
          )
        }
        
        // 处理修饰符
        // v-bind 属性修饰符: .prop .camel .sync
        // .camel: 将绑定的属性驼峰化
        // .sync:  简化子组件需要修改 prop 值的逻辑

        if (modifiers) {
          if (modifiers.prop && !isDynamic) {
            name = camelize(name)
            if (name === 'innerHtml') name = 'innerHTML'
          }
          if (modifiers.camel && !isDynamic) {
            name = camelize(name)
          }
          if (modifiers.sync) {
            // 事件的回调函数 (代码字符串)
            syncGen = genAssignmentCode(value, `$event`)
            if (!isDynamic) {
              // 在当前元素描述对象上添加事件侦听器
              addHandler(
                el,
                `update:${camelize(name)}`,
                syncGen,
                null,
                false,
                warn,
                list[i]
              )
              // some-prop => someProp  ( camelize  )
              // someProp  => some-prop ( hyphenate )
              // 由此可见 Vue 支持不同格式的属性:
              // 0. :prop.sync
              // 1. :some-prop.sync ( kebab-case )
              // 2. :someProp.sync  ( camel case )
              if (hyphenate(name) !== camelize(name)) {
                addHandler(
                  el,
                  `update:${hyphenate(name)}`,
                  syncGen,
                  null,
                  false,
                  warn,
                  list[i]
                )
              }
            } else {
              // handler w/ dynamic event name
              addHandler(
                el,
                `"update:"+(${name})`,
                syncGen,
                null,
                false,
                warn,
                list[i],
                true // dynamic
              )
            }
          }
        }
        if ((modifiers && modifiers.prop) || (
          !el.component && platformMustUseProp(el.tag, el.attrsMap.type, name)
        )) {
          addProp(el, name, value, list[i], isDynamic)
        } else {
          addAttr(el, name, value, list[i], isDynamic)
        }
      } else if (onRE.test(name)) { // v-on
        name = name.replace(onRE, '')
        isDynamic = dynamicArgRE.test(name)
        if (isDynamic) {
          name = name.slice(1, -1)
        }
        addHandler(el, name, value, modifiers, false, warn, list[i], isDynamic)
      } else { // normal directives
        /**
          解析 `自定义指令` 和 5个Vue内置的 `v-text`, `v-html`, `v-show`, `v-cloak`, `v-model`
          example: <span v-custom:args.modify="myMethod"></span>
        */
        
        // 去掉属性名称中的 'v-' 或 ':' 或 '@' 等字符
        name = name.replace(dirRE, '')
        // 解析自定义指令的参数, example: custom:args
        // parse arg
        const argMatch = name.match(argRE)
        let arg = argMatch && argMatch[1]
        isDynamic = false
        if (arg) {
          name = name.slice(0, -(arg.length + 1))
          if (dynamicArgRE.test(arg)) {
            arg = arg.slice(1, -1)
            isDynamic = true
          }
        }
        addDirective(el, name, rawName, value, arg, isDynamic, modifiers, list[i])
        if (process.env.NODE_ENV !== 'production' && name === 'model') {
          checkForAliasModel(el, value)
        }
      }
    } else {
      // 处理非指令属性
      // example: <div id="box" width="100px"></div> (id, width 属性)
      // 注意: 在中置处理函数中, 已经对 style class 做了预处理

      // literal attribute
      if (process.env.NODE_ENV !== 'production') {
        // example: <div id="{{ isTrue ? 'a' : 'b' }}"></div>
        const res = parseText(value, delimiters)
        if (res) {
          warn(
            `${name}="${value}": ` +
            'Interpolation inside attributes has been removed. ' +
            'Use v-bind or the colon shorthand instead. For example, ' +
            'instead of <div id="{{ val }}">, use <div :id="val">.',
            list[i]
          )
        }
      }
      addAttr(el, name, JSON.stringify(value), list[i])
      // #6887 firefox doesn't update muted state if set via attribute
      // even immediately after element creation
      if (!el.component &&
        name === 'muted' &&
        platformMustUseProp(el.tag, el.attrsMap.type, name)
      ) {
        addProp(el, name, 'true', list[i])
      }
    }
  }
}

function checkInFor (el: ASTElement): boolean {
  let parent = el
  while (parent) {
    if (parent.for !== undefined) {
      return true
    }
    parent = parent.parent
  }
  return false
}

function parseModifiers (name: string): Object | void {
  const match = name.match(modifierRE)
  if (match) {
    const ret = {}
    match.forEach(m => { ret[m.slice(1)] = true })
    return ret
  }
}

function makeAttrsMap (attrs: Array<Object>): Object {
  const map = {}
  for (let i = 0, l = attrs.length; i < l; i++) {
    if (
      process.env.NODE_ENV !== 'production' &&
      map[attrs[i].name] && !isIE && !isEdge
    ) {
      warn('duplicate attribute: ' + attrs[i].name, attrs[i])
    }
    map[attrs[i].name] = attrs[i].value
  }
  return map
}

// for script (e.g. type="x/template") or style, do not decode content
function isTextTag (el): boolean {
  return el.tag === 'script' || el.tag === 'style'
}

function isForbiddenTag (el): boolean {
  return (
    el.tag === 'style' ||
    (el.tag === 'script' && (
      !el.attrsMap.type ||
      el.attrsMap.type === 'text/javascript'
    ))
  )
}

const ieNSBug = /^xmlns:NS\d+/
const ieNSPrefix = /^NS\d+:/

/* istanbul ignore next */
function guardIESVGBug (attrs) {
  const res = []
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]
    if (!ieNSBug.test(attr.name)) {
      attr.name = attr.name.replace(ieNSPrefix, '')
      res.push(attr)
    }
  }
  return res
}

// checkForAliasModel 函数的作用就是从使用了 v-model 指令的标签开始,
// 逐层向上遍历父级标签的元素描述对象, 直到根元素为止, 当满足一定条件时给开发者合适的提醒
function checkForAliasModel (el, value) {
  `
  const list = [1, 2, 3]
  <div v-for="item of list">
    <input v-model="item" />
  </div>
  `
  let _el = el
  while (_el) {
    if (_el.for && _el.alias === value) {
      warn(
        `<${el.tag} v-model="${value}">: ` +
        `You are binding v-model directly to a v-for iteration alias. ` +
        `This will not be able to modify the v-for source array because ` +
        `writing to the alias is like modifying a function local variable. ` +
        `Consider using an array of objects and use v-model on an object property instead.`,
        el.rawAttrsMap['v-model']
      )
    }
    _el = _el.parent
  }
}
