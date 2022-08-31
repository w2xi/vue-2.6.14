/* @flow */

import { extend } from 'shared/util'
import { detectErrors } from './error-detector'
import { createCompileToFunctionFn } from './to-function'

export function createCompilerCreator (baseCompile: Function): Function {
  // createCompiler 函数作为 createCompilerCreator 函数的返回值
  return function createCompiler (baseOptions: CompilerOptions) {
    // 定义 compile 函数
    function compile (
      template: string,
      options?: CompilerOptions
    ): CompiledResult {
      const finalOptions = Object.create(baseOptions)
      const errors = []
      const tips = []

      // warn 函数用于收集编译过程中的错误和提示
      let warn = (msg, range, tip) => {
        (tip ? tips : errors).push(msg)
      }
      
      // 这里的 options 就是使用编译器编译模板时传递的选项参数, 或者可以简单理解为调用 compileToFunctions 函数时传递的选项参数
      // 其实我们可以把 baseOptions 理解为编译器的默认选项或者基本选项，而 options 是用来提供定制能力的扩展选项
      if (options) {
        if (process.env.NODE_ENV !== 'production' && options.outputSourceRange) {
          // $flow-disable-line
          const leadingSpaceLength = template.match(/^\s*/)[0].length
          // 非生产环境下 且 outputSourceRange 为 true 的情况下:
          // 重写 warn 方法
          warn = (msg, range, tip) => {
            const data: WarningMessage = { msg }
            if (range) {
              if (range.start != null) {
                data.start = range.start + leadingSpaceLength
              }
              if (range.end != null) {
                data.end = range.end + leadingSpaceLength
              }
            }
            (tip ? tips : errors).push(data)
          }
        }
        
        // 下面的代码会将 options 对象混合到 finalOptions 对象中

        // merge custom modules
        if (options.modules) {
          finalOptions.modules =
            (baseOptions.modules || []).concat(options.modules)
        }
        // merge custom directives
        if (options.directives) {
          finalOptions.directives = extend(
            Object.create(baseOptions.directives || null),
            options.directives
          )
        }
        // copy other options
        for (const key in options) {
          // 对于 options 中既不是 modules 又不是 directives 的其他属性, 直接复制到 finalOptions 中
          if (key !== 'modules' && key !== 'directives') {
            finalOptions[key] = options[key]
          }
        }
      }

      finalOptions.warn = warn

      const compiled = baseCompile(template.trim(), finalOptions)
      if (process.env.NODE_ENV !== 'production') {
        // 通过 抽象语法树(AST) 来检查模板中是否存在错误表达式的
        detectErrors(compiled.ast, warn)
      }
      // 将收集到的 错误(errors)和提示(tips) 添加到 compiled 上并返回
      compiled.errors = errors
      compiled.tips = tips
      return compiled
    }

    // 返回 compile 和 compileToFunctions
    return {
      compile,
      compileToFunctions: createCompileToFunctionFn(compile)
    }
  }
}
