/* @flow */

import { parse } from './parser/index'
import { optimize } from './optimizer'
import { generate } from './codegen/index'
import { createCompilerCreator } from './create-compiler'

// 创建 web 平台下的编译器
// createCompiler 函数是用来创建编译器的, 或者我们可以称该函数为 编译器的创建者

// `createCompilerCreator` allows creating compilers that use alternative
// parser/optimizer/codegen, e.g the SSR optimizing compiler.
// Here we just export a default compiler using the default parts.
export const createCompiler = createCompilerCreator(function baseCompile (
  template: string,
  options: CompilerOptions
): CompiledResult {
  // 1. 解析器: 将模板解析为AST
  // 2. 优化器: 遍历AST标记静态节点
  // 3. 代码生成器: 使用AST生成渲染函数

  // 调用 parse 函数将字符串模板解析成抽象语法树(AST)
  const ast = parse(template.trim(), options)
  if (options.optimize !== false) {
    // 调用 optimize 函数优化 ast, 标记静态节点
    optimize(ast, options)
  }
  // 调用 generate 函数将 ast 编译成渲染函数 (根据给定的AST生成目标平台的代码)
  const code = generate(ast, options)
  return {
    ast,
    render: code.render,
    staticRenderFns: code.staticRenderFns
  }
  // 其最终返回了抽象语法树(ast), 渲染函数(render), 静态渲染函数(staticRenderFns)
  // (
  //   注意以上提到的渲染函数, 都以字符串的形式存在, 
  //   因为真正变成函数的过程是在 compileToFunctions 中使用 new Function() 来完成的
  // )
})
