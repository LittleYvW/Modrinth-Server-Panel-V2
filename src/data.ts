export type Mod = {
  name: string;
  description: string;
  version: string;
  side: 'client' | 'both';
};
export const mods: Mod[] = [{
  name: 'Sodium',
  description: '为 Minecraft 打造的现代渲染引擎。',
  version: '0.5.3',
  side: 'client'
}, {
  name: 'Lithium',
  description: '让服务器运行更流畅的性能优化。',
  version: '0.11.2',
  side: 'both'
}, {
  name: 'Indium',
  description: '为 Sodium 提供渲染兼容支持。',
  version: '1.0.27',
  side: 'both'
}, {
  name: 'Fabric API',
  description: 'Fabric 模组不可或缺的基础接口。',
  version: '0.92.2',
  side: 'both'
}, {
  name: 'Mod Menu',
  description: '在游戏中轻松浏览与配置模组。',
  version: '7.2.2',
  side: 'client'
}, {
  name: 'Cloth Config',
  description: '简洁、灵活的模组配置库。',
  version: '11.1.118',
  side: 'both'
}];
