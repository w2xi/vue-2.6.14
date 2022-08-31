/* @flow */

import { noop, extend } from 'shared/util'
import { warn as baseWarn, tip } from 'core/util/debug'
import { generateCodeFrame } from './codeframe'

type CompiledFunctionResult = {
  render: Function;
  staticRenderFns: Array<Function>;
};

/**
 * @description: 生成渲染函数
 * @param {String} code   函数体字符串
 * @param {Array} errors  收集错误信息
 * @return {Funtion}
 */
function createFunction (code, errors) {
  try {
    return new Function(code)
  } catch (err) {
    errors.push({ err, code })
    return noop
  }
}

// 1、缓存编译结果，通过 createCompileToFunctionFn 函数内声明的 cache 常量实现。
// 2、调用 compile 函数将模板字符串转成渲染函数字符串
// 3、调用 createFunction 函数将渲染函数字符串转成真正的渲染函数
// 4、打印编译错误，包括：模板字符串 -> 渲染函数字符串 以及 渲染函数字符串 -> 渲染函数 这两个阶段的错误

export function createCompileToFunctionFn (compile: Function): Function {
  const cache = Object.create(null)

  return function compileToFunctions (
    template: string,
    options?: CompilerOptions,
    vm?: Component
  ): CompiledFunctionResult {
    options = extend({}, options)
    const warn = options.warn || baseWarn
    delete options.warn

    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production') {
      // detect possible CSP restriction
      try {
        // 检测 new Function() 是否可用, 并在某些情况下给你一个有用的提示
        new Function('return 1')
      } catch (e) {
        if (e.toString().match(/unsafe-eval|CSP/)) {
          warn(
            'It seems you are using the standalone build of Vue.js in an ' +
            'environment with Content Security Policy that prohibits unsafe-eval. ' +
            'The template compiler cannot work in this environment. Consider ' +
            'relaxing the policy to allow unsafe-eval or pre-compiling your ' +
            'templates into render functions.'
          )
        }
      }
    }

    // 缓存字符串模板的编译结果，防止重复编译，提升性能
    // check cache
    const key = options.delimiters
      ? String(options.delimiters) + template
      : template
    if (cache[key]) {
      // 如果命中缓存则直接返回编译结果
      return cache[key]
    }

    // compile
    const compiled = compile(template, options)

    // check compilation errors/tips
    if (process.env.NODE_ENV !== 'production') {
      // 如果编译过程中存在错误信息
      if (compiled.errors && compiled.errors.length) {
        if (options.outputSourceRange) {
          // 打印编译过程中的错误信息
          compiled.errors.forEach(e => {
            warn(
              `Error compiling template:\n\n${e.msg}\n\n` +
              generateCodeFrame(template, e.start, e.end),
              vm
            )
          })
        } else {
          warn(
            `Error compiling template:\n\n${template}\n\n` +
            compiled.errors.map(e => `- ${e}`).join('\n') + '\n',
            vm
          )
        }
      }
      // 打印编译过程中的提示信息
      if (compiled.tips && compiled.tips.length) {
        if (options.outputSourceRange) {
          compiled.tips.forEach(e => tip(e.msg, vm))
        } else {
          compiled.tips.forEach(msg => tip(msg, vm))
        }
      }
    }

    // turn code into functions
    const res = {}
    // 创建函数出错时的错误信息被 push 到这个数组里了
    const fnGenErrors = []
    // compiled 除了包含 render 字符串外，还包含一个字符串数组 staticRenderFns
    
    // render 是最终生成的渲染函数
    res.render = createFunction(compiled.render, fnGenErrors)
    // staticRenderFns 的主要作用是渲染优化
    res.staticRenderFns = compiled.staticRenderFns.map(code => {
      return createFunction(code, fnGenErrors)
    })

    // check function generation errors.
    // this should only happen if there is a bug in the compiler itself.
    // mostly for codegen development use
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== 'production') {
      if ((!compiled.errors || !compiled.errors.length) && fnGenErrors.length) {
        // 打印在生成渲染函数过程中的错误
        warn(
          `Failed to generate render function:\n\n` +
          fnGenErrors.map(({ err, code }) => `${err.toString()} in\n\n${code}\n`).join('\n'),
          vm
        )
      }
    }

    // 将编译结果缓存并返回编译结果
    return (cache[key] = res)
  }
}
