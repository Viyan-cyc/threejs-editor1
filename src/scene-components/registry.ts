import { shelfEntry } from './shelf'

/**
 * 自定义组件注册表（用户提供的 Three.js 组件库）。
 *
 * Code-first：组件以【工厂源码字符串】形式存在。componentBootstrapSource() 把它们
 * 打包成一段 JS，同时注入 sandbox iframe runtime 与 standalone HTML，
 * 使 LLM 的 createScene 可通过 `ctx.components.<Type>(params)` 调用。
 *
 * 组件生成 Object3D 后加入 scene，DSL 从运行后场景提取（绝不通过 DSL 创建/驱动组件）。
 */

export interface ComponentParamSchema {
  type: string
  description: string
  default?: unknown
}

export interface ComponentEntry {
  /** 组件类型标识（与 ctx.components 的键一致） */
  componentType: string
  /** 中文名 */
  name: string
  /** 给 LLM 看的描述 */
  description: string
  /** 参数 schema */
  paramsSchema: Record<string, ComponentParamSchema>
  /** 示例调用代码（给 LLM 参考） */
  exampleUsage: string
  /** 工厂源码：function (THREE, params) { ...; return Object3D } */
  factorySource: string
}

export const componentRegistry: ComponentEntry[] = [shelfEntry]

/** 给 LLM 的组件清单（不含工厂源码） */
export interface ComponentSummary {
  componentType: string
  name: string
  description: string
  paramsSchema: Record<string, ComponentParamSchema>
  exampleUsage: string
}

export function getComponentSummary(): ComponentSummary[] {
  return componentRegistry.map(({ componentType, name, description, paramsSchema, exampleUsage }) => ({
    componentType,
    name,
    description,
    paramsSchema,
    exampleUsage,
  }))
}

export function getRegisteredTypes(): string[] {
  return componentRegistry.map((entry) => entry.componentType)
}

/**
 * 共享 bootstrap 源码：在 THREE 作用域内构建 ctx.components。
 * runtime 与 standaloneHtml 都嵌入它，保证组件在沙箱与独立 HTML 中一致可用。
 */
export function componentBootstrapSource(): string {
  const entries = componentRegistry
    .map((entry) => `    '${entry.componentType}': ${entry.factorySource}`)
    .join(',\n')

  return [
    'function __buildComponents(THREE) {',
    '  var factories = {',
    entries,
    '  };',
    '  var components = {};',
    '  for (var name in factories) {',
    '    components[name] = function (factory) { return function (params) { return factory(THREE, params); }; }(factories[name]);',
    '  }',
    '  return components;',
    '}',
  ].join('\n')
}

/**
 * 扫描 sceneCode 中 `ctx.components.<X>` 引用，返回未注册的组件名。
 * 用于运行前预检（命中则不运行、保留上一版）。
 */
export function findUnknownComponentReferences(code: string): string[] {
  const registered = new Set(getRegisteredTypes())
  const refs = new Set<string>()
  const re = /ctx\.components\.([A-Za-z0-9_]+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(code)) !== null) {
    refs.add(match[1])
  }
  return [...refs].filter((ref) => !registered.has(ref))
}
