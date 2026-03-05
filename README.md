## 更新

1分钟内快速搭建教程：

> 用户先去[@BotFather](https://t.me/NodeForwardBot/BotFather)，输入 `/newbot` ，按照指引输入你要创建的机器人的昵称和名字，点击复制机器人吐出的token
> 
> 然后到[@NodeForwardBot](https://t.me/NodeForwardBot)粘贴，完活。
> 
> 详细信息可以参考：[https://www.nodeseek.com/post-286885-1](https://www.nodeseek.com/post-286885-1)

拥有无限配额（自建有每日1k消息上限），且托管在[cloudflare snippets](https://developers.cloudflare.com/rules/snippets/)，理论上不会掉线。如果需要自建，参考下面的自建教程。

基于cloudflare worker的telegram 消息转发bot，时间提醒，反欺诈功能

## 特点
- 基于cloudflare worker搭建，能够实现以下效果
    - 搭建成本低，一个js文件即可完成搭建
    - 不需要额外的域名，利用worker自带域名即可
    - 基于worker kv实现永久数据储存
    - 稳定，全球cdn转发
- 支持屏蔽用户，避免被骚扰

## 搭建方法
1. 从[@BotFather](https://t.me/BotFather)获取token，并且可以发送`/setjoingroups`来禁止此Bot被添加到群组
2. 从[uuidgenerator](https://www.uuidgenerator.net/)获取一个随机uuid作为secret
3. 从[@username_to_id_bot](https://t.me/username_to_id_bot)获取你的用户id
4. 登录[cloudflare](https://workers.cloudflare.com/)，创建一个worker
5. 配置worker的变量
    - 增加一个`ENV_BOT_TOKEN`变量，数值为从步骤1中获得的token
    - 增加一个`ENV_BOT_SECRET`变量，数值为从步骤2中获得的secret
    - 增加一个`ENV_ADMIN_UID`变量，数值为从步骤3中获得的用户id
6. 绑定kv数据库，创建一个Namespace Name为`nfd`的kv数据库，在setting -> variable中设置`KV Namespace Bindings`：nfd -> nfd
7. 点击`Quick Edit`，复制[这个文件](./worker.js)到编辑器中
8. 通过打开`https://xxx.workers.dev`来注册websoket

## EasyCron 配置步骤（关键）
1. 注册 EasyCron（免费定时工具）
2. 打开 EasyCron 官网：https://www.easycron.com → 注册免费账号（邮箱验证即可）；
3.登录后点击「New Cron Job」创建第一个定时任务。
4. 配置 EasyCron 定时任务：
    - URL：https://你的Worker域名/sendTime?secret=ENV_BOT_SECRET
    - Cron Expression	整点：0 * * * * / 半点：30 * * * *
    - Time Zone	选择 Asia/Shanghai（北京时间）
    - HTTP Method	保持默认 GET（不用改）
    - 其他	可选超时时间设为 30 秒，可选「失败时邮件提醒」
6. 验证配置是否生效
    - URL：https://你的Worker域名/sendTime?secret=ENV_BOT_SECRET

## 核心功能总结
    - 基础功能保留：双向消息转发、北京时间整点 / 半点提醒、Webhook 注册 / 注销全部保留且正常运行；
    - 反诈识别全覆盖：
    - 文本识别：覆盖刷单、客服、公检法、婚恋杀猪盘、冒充领导、AI 换脸、养老诈骗等 2025 所有主流类型；
    - KV 数据库：支持手动 / 批量新增自定义诈骗数据，实现个性化识别；
 管理员专属命令：
    - /start 介绍描述
    - /addscam 关键词 类型 描述：新增单条自定义数据；
    - /queryscam 关键词：查询诈骗数据；
    - /scamstats：查看数据统计；
    - /batchaddscam [JSON数组]：批量导入自定义数据；
    - 双引擎识别：文本特征检测 + KV 数据库匹配，无数据也能识别，有数据更精准。

## Thanks
- [telegram-bot-cloudflare](https://github.com/cvzi/telegram-bot-cloudflare)
