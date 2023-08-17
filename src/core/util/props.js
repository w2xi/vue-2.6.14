/* @flow */

import { warn } from './debug'
import { observe, toggleObserving, shouldObserve } from '../observer/index'
import {
  hasOwn,
  isObject,
  toRawType,
  hyphenate,
  capitalize,
  isPlainObject
} from 'shared/util'

type PropOptions = {
  type: Function | Array<Function> | null,
  default: any,
  required: ?boolean,
  validator: ?Function
};

export function validateProp (
  key: string,
  propOptions: Object,
  propsData: Object,
  vm?: Component
): any {
  const prop = propOptions[key]
  // 代表着对应的 prop 在 propsData 上是否有数据. 如果 absent 为真，则代表 prop 数据缺失
  const absent = !hasOwn(propsData, key)
  let value = propsData[key]
  // 查找 Boolean 是否存在 prop.type 中, 如果存在,则返回对应的下标,否则返回 -1
  // boolean casting
  const booleanIndex = getTypeIndex(Boolean, prop.type)
  // 对 Boolean 类型做特殊处理
  // 如果 prop.type 中指定了 Boolean 类型
  if (booleanIndex > -1) {
    if (absent && !hasOwn(prop, 'default')) {
      value = false
    } else if (value === '' || value === hyphenate(key)) {
      // only cast empty string / same name to boolean if
      // boolean has higher priority
      const stringIndex = getTypeIndex(String, prop.type)
      // 如果 prop.type 中没有指定 String 类型 或者 
      //     指定了 String 类型 且 Boolean 的 [优先级] 比 String 高
      //     将 value 设置为 true
      if (stringIndex < 0 || booleanIndex < stringIndex) {
        value = true
      }
    }
  }
  // check default value
  if (value === undefined) {
    value = getPropDefaultValue(vm, prop, key)
    // since the default value is a fresh copy,
    // make sure to observe it.
    const prevShouldObserve = shouldObserve
    toggleObserving(true)
    // 将 value 转换为响应式数据
    observe(value)
    toggleObserving(prevShouldObserve)
  }
  if (
    process.env.NODE_ENV !== 'production' &&
    // skip validation for weex recycle-list child component props
    !(__WEEX__ && isObject(value) && ('@binding' in value))
  ) {
    // 非生产环境下 对 props 做类型校验
    assertProp(prop, key, value, vm, absent)
  }
  return value
}

/**
 * Get the default value of a prop.
 */
function getPropDefaultValue (vm: ?Component, prop: PropOptions, key: string): any {
  // no default, return undefined
  if (!hasOwn(prop, 'default')) {
    return undefined
  }
  const def = prop.default
  // warn against non-factory defaults for Object & Array
  if (process.env.NODE_ENV !== 'production' && isObject(def)) {
    // 非生产环境下, 如果默认值是 对象或数组类型 会提示用户: 应该使用一个工厂函数返回默认值
    warn(
      'Invalid default value for prop "' + key + '": ' +
      'Props with type Object/Array must use a factory function ' +
      'to return the default value.',
      vm
    )
  }
  // 下面代码完全是为组件更新时准备的
  // 当执行 updateChildComponent 函数更新组件时，在调用 validateProp 函数之前 vm.$options.propsData 还没有被更新
  // 所以当组件更新时如下代码中的 vm.$options.propsData 是上一次组件更新或创建时的数据
  // 所以如下 if 条件成立则说明:
  // 1、当前组件处于更新状态，且没有传递该 prop 数据给组件
  // 2、上一次更新或创建时外界也没有向组件传递该 prop 数据
  // 3、上一次组件更新或创建时该 prop 拥有一个不为 undefined 的默认值
  // 那么此时应该返回之前的 prop 值(即默认值)作为本次渲染该 prop 的默认值。这样就能避免触发没有意义的响应

  // the raw prop value was also undefined from previous render,
  // return previous default value to avoid unnecessary watcher trigger
  if (vm && vm.$options.propsData &&
    vm.$options.propsData[key] === undefined &&
    vm._props[key] !== undefined
  ) {
    return vm._props[key]
  }
  // call factory function for non-Function types
  // a value is Function if its prototype is function even across different execution context
  return typeof def === 'function' && getType(prop.type) !== 'Function'
    ? def.call(vm)
    : def
}

/**
 * Assert whether a prop is valid.
 */
function assertProp (
  prop: PropOptions,
  name: string,
  value: any,
  vm: ?Component,
  absent: boolean
) {
  if (prop.required && absent) {
    // 如果 prop 为必传 prop，但是外界却没有向组件传递该 prop 的值
    warn(
      'Missing required prop: "' + name + '"',
      vm
    )
    return
  }
  if (value == null && !prop.required) {
    return
  }
  let type = prop.type
  // 如果 valid 为 true, 即 未定义 prop 的类型 或者 直接将类型设为 true (则说明不需要做 prop 校验)
  // 否则 valid 为 false
  let valid = !type || type === true
  const expectedTypes = []
  if (type) {
    // 检测 type 是否是一个数组, 如果不是数组则将其包装成一个数组
    if (!Array.isArray(type)) {
      type = [type]
    }
    // 循环遍历 type 数组.
    // 一旦某个类型通过校验, 那么 valid 的值将变为 true, 此时 for 循环内的语句将不再执行.
    // 这是因为该 prop 值的类型只要满足期望类型中的一个即可.
    for (let i = 0; i < type.length && !valid; i++) {
      // 做类型断言，即判断外界传递的 prop 值的类型与期望的类型是否相符
      const assertedType = assertType(value, type[i], vm)
      expectedTypes.push(assertedType.expectedType || '')
      valid = assertedType.valid
    }
  }

  const haveExpectedTypes = expectedTypes.some(t => t)
  // 如果 valid 为 false, 表示未通过校验, 则说明该 prop 值的类型不在期望的类型之中
  if (!valid && haveExpectedTypes) {
    // 打印警告信息提示开发者所传递的 prop 值的类型不符合预期
    warn(
      getInvalidTypeMessage(name, value, expectedTypes),
      vm
    )
    return
  }
  const validator = prop.validator
  if (validator) {
    if (!validator(value)) {
      warn(
        'Invalid prop: custom validator check failed for prop "' + name + '".',
        vm
      )
    }
  }
}

const simpleCheckRE = /^(String|Number|Boolean|Function|Symbol|BigInt)$/

function assertType (value: any, type: Function, vm: ?Component): {
  valid: boolean;
  expectedType: string;
} {
  let valid
  const expectedType = getType(type)
  if (simpleCheckRE.test(expectedType)) {
    const t = typeof value
    valid = t === expectedType.toLowerCase()
    // for primitive wrapper objects
    if (!valid && t === 'object') {
      valid = value instanceof type
    }
  } else if (expectedType === 'Object') {
    valid = isPlainObject(value)
  } else if (expectedType === 'Array') {
    valid = Array.isArray(value)
  } else {
    // 此时说明开发者在定义 prop 时所指定的期望类型为自定义类型
    // example: props: { prop1: { type: funcion Dog() {} } }

    // https://github.com/vuejs/vue/issues/9224
    try {
      valid = value instanceof type
    } catch (e) {
      warn('Invalid prop type: "' + String(type) + '" is not a constructor', vm);
      valid = false;
    }
  }
  return {
    valid,
    expectedType
  }
}

const functionTypeCheckRE = /^\s*function (\w+)/

/**
 * Use function string name to check built-in types,
 * because a simple equality check will fail when running
 * across different vms / iframes.
 */
function getType (fn) {
  const match = fn && fn.toString().match(functionTypeCheckRE)
  return match ? match[1] : ''
}

function isSameType (a, b) {
  return getType(a) === getType(b)
}

function getTypeIndex (type, expectedTypes): number {
  if (!Array.isArray(expectedTypes)) {
    return isSameType(expectedTypes, type) ? 0 : -1
  }
  for (let i = 0, len = expectedTypes.length; i < len; i++) {
    if (isSameType(expectedTypes[i], type)) {
      return i
    }
  }
  return -1
}

function getInvalidTypeMessage (name, value, expectedTypes) {
  let message = `Invalid prop: type check failed for prop "${name}".` +
    ` Expected ${expectedTypes.map(capitalize).join(', ')}`
  const expectedType = expectedTypes[0]
  const receivedType = toRawType(value)
  // check if we need to specify expected value
  if (
    expectedTypes.length === 1 &&
    isExplicable(expectedType) &&
    isExplicable(typeof value) &&
    !isBoolean(expectedType, receivedType)
  ) {
    message += ` with value ${styleValue(value, expectedType)}`
  }
  message += `, got ${receivedType} `
  // check if we need to specify received value
  if (isExplicable(receivedType)) {
    message += `with value ${styleValue(value, receivedType)}.`
  }
  return message
}

function styleValue (value, type) {
  if (type === 'String') {
    return `"${value}"`
  } else if (type === 'Number') {
    return `${Number(value)}`
  } else {
    return `${value}`
  }
}

const EXPLICABLE_TYPES = ['string', 'number', 'boolean']
function isExplicable (value) {
  return EXPLICABLE_TYPES.some(elem => value.toLowerCase() === elem)
}

function isBoolean (...args) {
  return args.some(elem => elem.toLowerCase() === 'boolean')
}
