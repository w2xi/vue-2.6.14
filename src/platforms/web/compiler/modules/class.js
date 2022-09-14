/* @flow */

import { parseText } from 'compiler/parser/text-parser'
import {
  getAndRemoveAttr,
  getBindingAttr,
  baseWarn
} from 'compiler/helpers'

// <div class="static-class" :class="['dynamical', 'activeClass']"></div>
// el.staticClass = JSON.stringify('static-class')
// el.classBinding = "['dynamical', 'activeClass']"

function transformNode (el: ASTElement, options: CompilerOptions) {
  const warn = options.warn || baseWarn
  // 获取静态非绑定class属性
  const staticClass = getAndRemoveAttr(el, 'class')
  if (process.env.NODE_ENV !== 'production' && staticClass) {
    // 例如:      <div class="{{ val }}"></div>
    // 应该替换为  <div :class="val"></div>

    const res = parseText(staticClass, options.delimiters)
    if (res) {
      warn(
        `class="${staticClass}": ` +
        'Interpolation inside attributes has been removed. ' +
        'Use v-bind or the colon shorthand instead. For example, ' +
        'instead of <div class="{{ val }}">, use <div :class="val">.',
        el.rawAttrsMap['class']
      )
    }
  }
  if (staticClass) {
    el.staticClass = JSON.stringify(staticClass.replace(/\s+/g, ' ').trim())
  }
  // 获取动态绑定class属性
  const classBinding = getBindingAttr(el, 'class', false /* getStatic */)
  if (classBinding) {
    el.classBinding = classBinding
  }
}

function genData (el: ASTElement): string {
  let data = ''
  if (el.staticClass) {
    data += `staticClass:${el.staticClass},`
  }
  if (el.classBinding) {
    data += `class:${el.classBinding},`
  }
  return data
}

export default {
  staticKeys: ['staticClass'],
  transformNode,
  genData
}
