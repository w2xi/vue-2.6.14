/* @flow */

import { baseOptions } from './options'
import { createCompiler } from 'compiler/index'

// 这里通过 createCompiler 函数的返回值解构出 compileToFunctions
const { compile, compileToFunctions } = createCompiler(baseOptions)

// 实际上 compile 函数与 compileToFunctions 函数的区别
// 就在于 compile 函数生成的是字符串形式的代码, 而 compileToFunctions 生成的才是真正可执行的代码
export { compile, compileToFunctions }
