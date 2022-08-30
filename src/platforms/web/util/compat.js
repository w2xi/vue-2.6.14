/* @flow */

import { inBrowser } from 'core/util/index'

// check whether current browser encodes a char inside attribute values
let div
function getShouldDecode (href: boolean): boolean {
  div = div || document.createElement('div')
  div.innerHTML = href ? `<a href="\n"/>` : `<div a="\n"/>`
  return div.innerHTML.indexOf('&#10;') > 0
}

// 当前最新的 chrome 浏览器已经没有该 bug

// 如果 shouldDecodeNewlines 为 true，意味着 Vue 在编译模板的时候，要对属性值中的换行符或制表符做兼容处理
// #3663: IE encodes newlines inside attribute values while other browsers don't
export const shouldDecodeNewlines = inBrowser ? getShouldDecode(false) : false

// 如果 shouldDecodeNewlinesForHref 为 true 意味着 Vue 在编译模板的时候，要对 a 标签的 href 属性值中的换行符或制表符做兼容处理
// #6828: chrome encodes content in a[href]
export const shouldDecodeNewlinesForHref = inBrowser ? getShouldDecode(true) : false
