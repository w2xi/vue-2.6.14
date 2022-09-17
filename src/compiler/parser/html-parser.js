/**
 * Not type-checking this file because it's mostly vendor code.
 */

/*!
 * HTML Parser By John Resig (ejohn.org)
 * Modified by Juriy "kangax" Zaytsev
 * Original code by Erik Arvidsson (MPL-1.1 OR Apache-2.0 OR GPL-2.0-or-later)
 * http://erik.eae.net/simplehtmlparser/simplehtmlparser.js
 */

import { makeMap, no } from 'shared/util'
import { isNonPhrasingTag } from 'web/compiler/util'
import { unicodeRegExp } from 'core/util/lang'

// Regular Expressions for parsing tags and attributes

// attribute 用来匹配标签的属性
const attribute = /^\s*([^\s"'<>\/=]+)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
const dynamicArgAttribute = /^\s*((?:v-[\w-]+:|@|:|#)\[[^=]+?\][^\s"'<>\/=]*)(?:\s*(=)\s*(?:"([^"]*)"+|'([^']*)'+|([^\s"'=<>`]+)))?/
const ncname = `[a-zA-Z_][\\-\\.0-9_a-zA-Z${unicodeRegExp.source}]*`
const qnameCapture = `((?:${ncname}\\:)?${ncname})`
// 匹配开始标签的一部分
const startTagOpen = new RegExp(`^<${qnameCapture}`)
// 匹配开始标签结束部分的 `>` 或 `/>`, 有一个捕获组
const startTagClose = /^\s*(\/?)>/
// 匹配结束标签
const endTag = new RegExp(`^<\\/${qnameCapture}[^>]*>`)
// 匹配文档的 DOCTYPE 标签
const doctype = /^<!DOCTYPE [^>]+>/i
// 匹配注释节点
// #7298: escape - to avoid being passed as HTML comment when inlined in page
const comment = /^<!\--/
// 匹配条件注释节点
const conditionalComment = /^<!\[/

// 检测给定的标签名字是不是纯文本标签
// Special Elements (can contain anything)
export const isPlainTextElement = makeMap('script,style,textarea', true)
const reCache = {}

const decodingMap = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&amp;': '&',
  '&#10;': '\n',
  '&#9;': '\t',
  '&#39;': "'"
}
const encodedAttr = /&(?:lt|gt|quot|amp|#39);/g
const encodedAttrWithNewLines = /&(?:lt|gt|quot|amp|#39|#10|#9);/g

// 检测给定的标签是否是 <pre> 标签或者 <textarea> 标签
// #5992
const isIgnoreNewlineTag = makeMap('pre,textarea', true)
// 检测是否应该忽略元素 pre 和 textarea 内容的第一个换行符
const shouldIgnoreFirstNewline = (tag, html) => tag && isIgnoreNewlineTag(tag) && html[0] === '\n'

// 解码 html 实体
function decodeAttr (value, shouldDecodeNewlines) {
  const re = shouldDecodeNewlines ? encodedAttrWithNewLines : encodedAttr
  return value.replace(re, match => decodingMap[match])
}

export function parseHTML (html, options) {
  // 使用栈来检测 html 字符串中是否缺少闭合标签
  const stack = []
  const expectHTML = options.expectHTML
  // 检测一个标签是否是一元标签
  const isUnaryTag = options.isUnaryTag || no
  // 检测一个标签是否是可以省略闭合标签的非一元标签
  const canBeLeftOpenTag = options.canBeLeftOpenTag || no
  // 初始值为 0, 标识着当前字符流的读入位置
  let index = 0
  // last 存储剩余还未 parse 的 html 字符串
  // lastTag 存储 stack 栈顶的元素, 即 最近一次遇到的非一元标签的开始标签
  let last, lastTag

  // 开启一个 while 循环，循环结束的条件是 html 为空，即 html 被 parse 完毕
  while (html) {
    last = html
    
    // lastTag && isPlainTextElement(lastTag) 为 true 就会执行 else 分支, 否则执行 if 分支
    // 含义: 最近一次(上一次)遇到的非一元标签是纯文本标签(即：script,style,textarea 标签)
    // 也就是说：当前我们正在处理的是纯文本标签里面的内容 (else 分支)

    // Make sure we're not in a plaintext content element like script/style
    if (!lastTag || !isPlainTextElement(lastTag)) {
      // 确保即将 parse 的内容不是在纯文本标签里 (script,style,textarea)

      let textEnd = html.indexOf('<')
      if (textEnd === 0) {
        // 用于处理标签
        // 处理 html 的第一个字符是 `<`:
        // 可能的情况: 注释, 条件注释, doctype, 开始标识, 结束标签

        // Comment:
        if (comment.test(html)) {
          const commentEnd = html.indexOf('-->')

          if (commentEnd >= 0) {
            // https://v2.cn.vuejs.org/v2/api/#comments
            if (options.shouldKeepComment) {
              options.comment(html.substring(4, commentEnd), index, index + commentEnd + 3)
            }
            advance(commentEnd + 3)
            continue
          }
        }

        // http://en.wikipedia.org/wiki/Conditional_comment#Downlevel-revealed_conditional_comment
        if (conditionalComment.test(html)) {
          const conditionalEnd = html.indexOf(']>')

          if (conditionalEnd >= 0) {
            advance(conditionalEnd + 2)
            continue
          }
        }

        // Doctype: 
        const doctypeMatch = html.match(doctype)
        if (doctypeMatch) {
          advance(doctypeMatch[0].length)
          continue
        }

        // End tag:
        const endTagMatch = html.match(endTag)
        if (endTagMatch) {
          const curIndex = index
          advance(endTagMatch[0].length)
          parseEndTag(endTagMatch[1], curIndex, index)
          continue
        }

        // Start tag:
        const startTagMatch = parseStartTag()
        if (startTagMatch) {
          handleStartTag(startTagMatch)
          if (shouldIgnoreFirstNewline(startTagMatch.tagName, html)) {
            advance(1)
          }
          continue
        }
      }

      let text, rest, next
      if (textEnd >= 0) {
        // 用于处理文本内容
        // 处理 html 的第一个字符是: 
        // (1) `<`, 但是没有成功匹配标签 (注释标签, 条件注释, doctype, 开始标识, 结束标签 5种情况)
        //      比如字符串: `< 2`, 虽然以 `<` 开头, 但是什么标签都不是.
        // (2) 或第一个字符不是 `<` 的字符串.
        //      比如字符串: '0<1<2', a<div>b</div> (处理 a, b 时会进入该 if 条件)

        rest = html.slice(textEnd)
        // while 循环条件为 true:
        // 不是结束标签 && 不是开始标识 && 不是注释标签 && 不是条件注释
        while (
          !endTag.test(rest) &&
          !startTagOpen.test(rest) &&
          !comment.test(rest) &&
          !conditionalComment.test(rest)
        ) {
          // < in plain text, be forgiving and treat it as text
          next = rest.indexOf('<', 1)
          if (next < 0) break
          textEnd += next
          rest = html.slice(textEnd)
        }
        text = html.substring(0, textEnd)
      }

      if (textEnd < 0) {
        // 整个 html 字符串作为文本处理
        text = html
      }

      if (text) {
        advance(text.length)
      }

      if (options.chars && text) {
        // 调用 parser 的钩子函数 解析文本
        options.chars(text, index - text.length, index)
      }
    } else {
      // 即将 parse 的内容是在纯文本标签里 (script,style,textarea)
      // example: html = '<textarea>123</textarea>'
      let endTagLength = 0
      const stackedTag = lastTag.toLowerCase()
      const reStackedTag = reCache[stackedTag] || (reCache[stackedTag] = new RegExp('([\\s\\S]*?)(</' + stackedTag + '[^>]*>)', 'i'))
      const rest = html.replace(reStackedTag, function (all, text, endTag) {
        endTagLength = endTag.length
        if (!isPlainTextElement(stackedTag) && stackedTag !== 'noscript') {
          text = text
            .replace(/<!\--([\s\S]*?)-->/g, '$1') // #7298
            .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
        }
        if (shouldIgnoreFirstNewline(stackedTag, text)) {
          text = text.slice(1)
        }
        if (options.chars) {
          options.chars(text)
        }
        return ''
      })
      index += html.length - rest.length
      html = rest
      // 解析纯文本标签的结束标签
      parseEndTag(stackedTag, index - endTagLength, index)
    }

    // 将整个字符串作为文本对待
    if (html === last) {
      options.chars && options.chars(html)
      if (process.env.NODE_ENV !== 'production' && !stack.length && options.warn) {
        options.warn(`Mal-formatted tag at end of template: "${html}"`, { start: index + html.length })
      }
      break
    }
  }

  // Clean up any remaining tags
  parseEndTag()

  function advance (n) {
    index += n
    html = html.substring(n)
  }
  // parse 开始标签
  function parseStartTag () {
    const start = html.match(startTagOpen)
    if (start) {
      const match = {
        tagName: start[1],  // 匹配到的标签名
        attrs: [],          // 存储被匹配到的属性
        start: index
      }
      advance(start[0].length)
      let end, attr
      // while 循环条件为 true 的条件:
      // 1. 没有匹配到开始标签的结束部分
      // 2. 匹配到了开始标签中的属性
      while (!(end = html.match(startTagClose)) && (attr = html.match(dynamicArgAttribute) || html.match(attribute))) {
        attr.start = index
        advance(attr[0].length)
        attr.end = index
        match.attrs.push(attr)
      }
      // 如果匹配到了开始标签的 结束部分
      if (end) {
        // end 存在则有两种情况:
        // 1. html = <br />, end = ['/>', '/']
        // 2. html = <div>,  end = ['>', '']
        // end[1] 存在则说明是`一元标签` (开始标签的结束部分是否使用 '/')
        match.unarySlash = end[1]
        advance(end[0].length)
        match.end = index

        // 只有当 end 存在时, 即确实解析到了一个开始标签的时候, parseStartTag 函数才会有返回值. 否则返回 undefined
        return match
      }
    }
  }
  // 处理 parseStartTag 的结果
  function handleStartTag (match) {
    const tagName = match.tagName
    const unarySlash = match.unarySlash

    if (expectHTML) {
      // 如果上一次遇到的开始标签是 p 标签, 并且当前正在解析的开始标签是 非`段落式内容模型`标签
      if (lastTag === 'p' && isNonPhrasingTag(tagName)) {
        // p 标签的特性是只允许包含 段落式内容
        // example:
        // <p><h2></h2></p> 
        // => 调用 parseEndTag 函数闭合 p 标签
        // <p></p><h2></h2></p>
        // => 接着继续解析 html, 最后会被解析为
        // <p></p><h2></h2><p></p>
        parseEndTag(lastTag)
      }
      // 当前正在解析的标签是一个可以省略结束标签的标签，并且与上一次解析到的开始标签相同
      if (canBeLeftOpenTag(tagName) && lastTag === tagName) {
        parseEndTag(tagName)
      }
    }
    // 标识是否是一元标签
    // 如果是自定义组件, 比如: <my-component />, unarySlash 的值为 true
    const unary = isUnaryTag(tagName) || !!unarySlash

    const l = match.attrs.length
    const attrs = new Array(l)
    // for 循环的作用是：格式化 match.attrs 数组，并将格式化后的数据存储到常量 attrs 中
    for (let i = 0; i < l; i++) {
      const args = match.attrs[i]
      // 属性值
      const value = args[3] || args[4] || args[5] || ''
      const shouldDecodeNewlines = tagName === 'a' && args[1] === 'href'
        ? options.shouldDecodeNewlinesForHref
        : options.shouldDecodeNewlines
      attrs[i] = {
        name: args[1],
        value: decodeAttr(value, shouldDecodeNewlines)
      }
      if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
        attrs[i].start = args.start + args[0].match(/^\s*/).length
        attrs[i].end = args.end
      }
    }

    // 如果开始标签是非一元标签
    if (!unary) {
      stack.push({ tag: tagName, lowerCasedTag: tagName.toLowerCase(), attrs: attrs, start: match.start, end: match.end })
      // 将 lastTag 的值设置为该标签名
      lastTag = tagName
    }

    if (options.start) {
      // 调用 parser 的钩子函数
      options.start(tagName, attrs, unary, match.start, match.end)
    }
  }
  // parse 结束标签
  // parseEndTag 函数主要有三个作用:
  // 1. 检测是否缺少闭合标签. 如果缺少结束标签, 则给用户一个提示: 标签 div 缺少结束标签
  //    example: <article><section><div></section></article>
  // 2. 处理 stack 栈中剩余未被处理的标签
  //    example: <article><section></section></article><div>
  //    解析完 html 后, 此时 stack 栈非空( [{ tag: 'div', ... }] )
  // 3. 解析 </br> 与 </p> 标签, 与浏览器的行为相同
  //     </br> => <br>; </p> => <p></p>

  // parseEndTag 函数的使用方式有三种:
  // 1. 处理普通的结束标签，此时 三个参数都传递.
  // 2. 只传递第一个参数 (在 handleStartTag 函数中)
  // 3. 不传递参数. 处理 stack 栈剩余未处理的标签.
  function parseEndTag (tagName, start, end) {
    // pos 用于判断是否有元素缺少闭合标签
    let pos, lowerCasedTagName
    if (start == null) start = index
    if (end == null) end = index

    // Find the closest opened tag of the same type
    if (tagName) {
      lowerCasedTagName = tagName.toLowerCase()
      // for 循环的作用: 寻找当前解析的结束标签所对应的开始标签在 stack 栈中的位置
      for (pos = stack.length - 1; pos >= 0; pos--) {
        if (stack[pos].lowerCasedTag === lowerCasedTagName) {
          break
        }
      }
      // 当 tagName 没有在 stack 栈中找到对应的开始标签时, pos 为 -1
      // 说明只写了结束标签而没写开始标签, 比如: </br> </p> ( </div> 会被忽略 )
    } else {
      // If no tag name is provided, clean shop
      pos = 0
    }

    if (pos >= 0) {
      // example: <article><section><div></section></article>
      // 当解析到 section 结束标签时:
      // stack 中包含三个元素: article, section, div; pos = 1; stack.length = 3
      // 循环遍历 stack 时, 会提示: 标签 div 未匹配到结束标签

      // Close all the open elements, up the stack
      for (let i = stack.length - 1; i >= pos; i--) {
        // 如果发现 stack 数组中存在索引大于 pos 的元素, 那么该元素一定是缺少闭合标签的
        if (process.env.NODE_ENV !== 'production' &&
          (i > pos || !tagName) &&
          options.warn
        ) {
          options.warn(
            `tag <${stack[i].tag}> has no matching end tag.`,
            { start: stack[i].start, end: stack[i].end }
          )
        }
        if (options.end) {
          // 将未闭合的标签闭合, 以保证解析结果的正确性
          options.end(stack[i].tag, start, end)
        }
      }

      // Remove the open elements from the stack
      stack.length = pos
      lastTag = pos && stack[pos - 1].tag
    } else if (lowerCasedTagName === 'br') {
      // </br> => <br>
      if (options.start) {
        options.start(tagName, [], true, start, end)
      }
    } else if (lowerCasedTagName === 'p') {
      // </p> => <p></p>
      if (options.start) {
        options.start(tagName, [], false, start, end)
      }
      if (options.end) {
        options.end(tagName, start, end)
      }
    }
  }
}
