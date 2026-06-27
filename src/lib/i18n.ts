export const LANGS = ['en', 'cn', 'zh-tw', 'ja', 'ko', 'de', 'it', 'fr', 'es'] as const;
export type Lang = typeof LANGS[number];

export const LANGUAGE_META: Record<Lang, { label: string; shortLabel: string; locale: string }> = {
  en: { label: 'English', shortLabel: 'EN', locale: 'en-US' },
  cn: { label: '简体中文', shortLabel: '简', locale: 'zh-CN' },
  'zh-tw': { label: '繁體中文', shortLabel: '繁', locale: 'zh-TW' },
  ja: { label: '日本語', shortLabel: 'JA', locale: 'ja-JP' },
  ko: { label: '한국어', shortLabel: 'KO', locale: 'ko-KR' },
  de: { label: 'Deutsch', shortLabel: 'DE', locale: 'de-DE' },
  it: { label: 'Italiano', shortLabel: 'IT', locale: 'it-IT' },
  fr: { label: 'Français', shortLabel: 'FR', locale: 'fr-FR' },
  es: { label: 'Español', shortLabel: 'ES', locale: 'es-ES' },
};

const LANG_SET = new Set<string>(LANGS);

export function normalizeLang(value: unknown): Lang {
  return typeof value === 'string' && LANG_SET.has(value) ? (value as Lang) : 'en';
}

export function localeOf(lang: Lang): string {
  return LANGUAGE_META[lang].locale;
}

export function isZhLang(lang: Lang): boolean {
  return (['cn', 'zh-tw'] as readonly Lang[]).includes(lang);
}

const baseT = {
  cn: {
    nav: {
      subtitle: 'Kickstarter 数据平台',
      overview: '数据概览',
      projects: '项目列表',
      predict: '项目预测',
      analysis: '数据分析',
      categories: '类目分析',
      trends: '趋势分析',
      countries: '国家分析',
      sync: '数据同步',
      about: '关于 Kicksonar',
      github: 'GitHub',
      leaderboard: '排行榜',
      awards: '声纳奖',
      liveIntel: 'Live 情报',
      favorites: '收藏夹',
      apiAccess: 'API / MCP 接入',
      mcpDocs: '使用文档',
      dataQuality: '数据质量',
      analytics: '站点分析',
      users: '用户看板',
      updates: '更新推送',
      globalConfig: '全局配置',
      adminViews: '管理员视图',
    },
    dashboard: {
      title: '数据概览',
      subtitle: 'Kickstarter 众筹平台全量数据分析',
      totalProjects: '总项目数',
      totalProjectsSub: '全平台历史累计',
      successRate: '项目成功率',
      successRateSub: (n: string) => `${n} 个项目成功`,
      totalRaised: '总众筹金额',
      totalRaisedSub: '美元，历史累计',
      avgBackers: '平均支持人数',
      avgBackersSub: '每个项目平均',
      statusDist: '项目状态分布',
      categoryRate: '各类目成功率 Top 12',
      trendTitle: '近24个月项目发起趋势',
      trendSuccessTitle: '近24个月成功率趋势',
      launches: '发起数量',
      successes: '成功数量',
      successRatePct: '成功率 (%)',
      categoryCount: '各类目项目数量 Top 12',
      totalCount: '总项目数',
      successCount: '成功项目数',
    },
    states: {
      successful: '成功',
      failed: '失败',
      live: '进行中',
      canceled: '已取消',
      suspended: '已暂停',
      prelaunch: '预热中',
    },
    categories: {
      title: '类目分析',
      subtitle: '各类目项目成功率、融资金额对比（仅含已结束项目）',
      chartRate: '各类目成功率',
      chartRaised: '各类目总融资金额',
      chartDist: '各类目项目数量分布',
      tableTitle: '类目详细数据',
      colCategory: '类目',
      colTotal: '总项目数',
      colSuccess: '成功',
      colFailed: '失败',
      colRate: '成功率',
      colRaised: '总融资',
      colAvg: '平均融资',
      colBackers: '总支持人数',
      total: '总项目数',
      successful: '成功数',
      failed: '失败数',
      rate: '成功率 (%)',
      raised: '总金额 (M USD)',
    },
    trends: {
      title: '趋势分析',
      subtitle: '近36个月 Kickstarter 月度趋势（仅含已结束项目）',
      months: '统计月份',
      monthsUnit: '个月',
      totalProjects: '区间内总项目',
      avgSuccess: '平均月成功率',
      peakMonth: '最高发起月',
      chartTitle: '月度项目发起 & 成功数量',
      launches: '发起项目数',
      successes: '成功项目数',
      rateTitle: '月度成功率趋势',
      raisedTitle: '月度融资总额趋势',
      raisedName: '融资金额 (M USD)',
      successRate: '成功率 (%)',
      tableTitle: '月度明细数据',
      colMonth: '月份',
      colLaunches: '发起项目数',
      colSuccess: '成功项目数',
      colRate: '成功率',
      colRaised: '融资总额',
      colShare: '发起量占比',
    },
    countries: {
      title: '国家/地区分析',
      subtitle: '各国家和地区众筹表现对比（仅含已结束项目）',
      chartCount: '项目数量 Top 10 国家',
      chartRate: '成功率 Top 10 国家',
      chartRaised: '融资总额 Top 10 国家',
      tableTitle: '国家/地区详细数据',
      colRank: '排名',
      colCountry: '国家/地区',
      colTotal: '总项目数',
      colSuccess: '成功项目',
      colRate: '成功率',
      colRaised: '融资总额',
      colBackers: '支持人数',
      total: '总项目数',
      successful: '成功项目数',
      rate: '成功率 (%)',
      raised: '融资总额 (M USD)',
    },
    projects: {
      title: '项目列表',
      subtitle: '搜索和筛选 Kickstarter 历史项目',
      period: '发起时间',
      searchLabel: '搜索项目',
      searchPlaceholder: '项目名称或描述...',
      statusLabel: '状态',
      categoryLabel: '类目',
      countryLabel: '国家',
      sortLabel: '排序',
      searchBtn: '搜索',
      exportSelected: (n: number) => `导出已选 (${n})`,
      exportPage: '导出本页',
      total: (n: string) => `共 ${n} 个项目`,
      pageOf: (p: number, t: number) => `第 ${p} 页 / 共 ${t} 页`,
      colName: '项目名称',
      colStatus: '状态',
      colCategory: '类目',
      colGoal: '目标',
      colPledged: '实际金额',
      colFunded: '完成率',
      colBackers: '支持人数',
      colDays: '时长(天)',
      colCountry: '国家',
      colLaunch: '发起日期',
      periods: {
        all: '全部时间',
        week: '近一周',
        month: '近一月',
        year: '近一年',
        custom: '自定义',
      },
      sorts: {
        usd_pledged: '众筹金额',
        backers: '支持人数',
        funding_rate: '完成率',
        launched: '最新发起',
      },
      states: {
        all: '全部',
        live: '进行中',
        prelaunch: '预热中',
        successful: '成功',
        failed: '失败',
        canceled: '已取消',
        suspended: '已暂停',
      },
      allCategories: '全部类目',
      allCountries: '全部国家',
      staffPick: '精选',
    },
    settings: {
      title: '数据同步',
      subtitle: '管理三个数据来源的同步状态',
      dbStatus: '数据库状态',
      projectCount: '项目总数',
      lastSync: '最近同步时间',
      manualSync: '手动同步',
      dataSource: '数据来源',
      syncDesc: '每次只下载 webrobots.io 最新一期数据集（压缩约 100MB，约 200万条项目记录），解析后写入本地 SQLite 数据库。同步时间约 5~15 分钟，请勿关闭应用。',
      autoSync: '自动同步：每天凌晨4点检查 webrobots 是否发布新数据集；只有发现新版本才会下载同步。',
      syncBtn: '立即同步',
      syncing: '同步中...',
      imported: (n: string) => `已导入: ${n} 条记录`,
      history: '同步历史',
      success: '成功',
      failed: '失败',
      duration: (d: string) => `耗时: ${d}`,
      records: (n: string) => `导入 ${n} 条记录`,
      infoTitle: '数据说明',
      infoItems: [
        '数据来源：webrobots.io 每月爬取的 Kickstarter 全量快照',
        '数据格式：CSV（ZIP压缩），包含约 20+ 个字段',
        '历史数据：2016年3月至今，每月一份快照',
        '同步策略：服务启动时自动检测新版本；每天凌晨4点再次检查，发现新版本才同步',
        '数据库：本地 SQLite，存储于 data/kickstarter.db',
        'KS Live：每2小时自动抓取 Kickstarter 发现页新项目',
        'Kicktraq：每6小时自动抓取活跃项目，与已有数据智能去重合并',
      ],
      // Live sync
      liveSync: 'KS 实时发现',
      liveSyncDesc: '从 Kickstarter 发现页抓取最新上线的项目（按最新排序），补充 webrobots 快照之后的新项目。',
      liveSyncBtn: '立即抓取',
      liveSyncing: '抓取中...',
      liveSyncAuto: '自动执行：后台每 2 小时自动运行一次，抓取最近 3 天内上线的项目。',
      liveSyncPages: '抓取页数',
      liveSyncState: '项目状态',
      liveSyncStateAll: '全部',
      liveSyncStateLive: '进行中',
      liveSyncStateSuccessful: '已成功',
      // Kicktraq sync
      kicktraqSync: 'Kicktraq 活跃项目',
      kicktraqSyncDesc: '从 Kicktraq 抓取当前活跃众筹项目列表，补充 Kickstarter 直接抓取的盲区。',
      kicktraqSyncBtn: '立即抓取',
      kicktraqSyncing: '抓取中...',
      kicktraqSyncAuto: '自动执行：后台每 6 小时自动运行一次。',
      kicktraqPages: '抓取页数',
    },
    projectDetail: {
      loading: '加载中...',
      notFound: '项目未找到',
      backToList: '返回列表',
      back: '返回项目列表',
      staffPick: 'Kickstarter 精选',
      createdBy: (name: string) => `由 ${name} 发起`,
      fundingOf: (goal: string) => `${goal} 目标`,
      goalLabel: (goal: string) => `目标: ${goal}`,
      exceeded: '已超额完成',
      belowGoal: '未达标',
      backers: '支持人数',
      backersUnit: (n: string) => `${n} 人`,
      goal: '众筹目标',
      duration: '活动时长',
      daysUnit: (n: number) => `${n} 天`,
      dailyAvg: '日均众筹',
      timeline: '活动时间线',
      timelineCreated: '创建时间',
      timelineLaunched: '发起时间',
      timelineDeadline: '截止时间',
      curveName: '众筹进度曲线（模拟）',
      curveNote: '基于 Kickstarter 典型众筹节奏（快速起步 → 平稳推进 → 末期冲刺）的模拟估算，非真实逐日数据。',
      dayFirst: '发起第 1 天',
      dayMid: (n: number) => `第 ${n} 天`,
      dayLast: (n: number) => `第 ${n} 天`,
      legendMet: '达成目标 ≥ 100%',
      legendBelow: '低于目标',
      dataTitle: '关于项目数据：',
      dataBody: '当前数据来源为 webrobots.io 提供的 Kickstarter 静态快照，仅包含项目最终状态，不含逐日众筹金额。如需查看真实逐日趋势，请访问',
      dataBody2: '。Kicksonar 将在后续版本中支持逐日数据采集。',
      // Social Blade style detail page
      tabOverview: '概览',
      tabCurve: '数字曲线',
      tabRewards: '奖励档位',
      tabChanges: '文案变更',
      tabCollaborators: '合作者',
      tabSimilar: '相似项目',
      pledgedOf: (goal: string) => `已筹款，目标 ${goal}`,
      fundedLabel: '完成率',
      backersLabel: '支持人数',
      dayCampaign: '天活动',
      avgPerDay: '日均',
      saved: '已收藏',
      saveBtn: '收藏',
      trackingBtn: '追踪中',
      trackBtn: '追踪',
      syncingBtn: '同步中…',
      syncNow: '立即同步',
      lastSynced: '上次同步',
      fundingGrade: '融资评级',
      fundingRateLabel: '完成率',
      totalRaisedLabel: '总融资额',
      goalPrefix: (goal: string) => `目标: ${goal}`,
      dayAvgSuffix: '/天平均',
      snapshotTitle: '每日快照历史',
      snapshotRecords: (n: number) => `${n} 条记录`,
      colDate: '日期',
      colPledged: '已筹款',
      colChange: '变化',
      colBackers: '支持人数',
      colDelta: '+/-',
      colDaysLeft: '剩余天数',
      colComments: '评论',
      colUpdates: '更新',
      colSource: '来源',
      noHistoricalData: '该项目暂无历史数据。',
      fetchFromKS: '从 Kickstarter 获取',
      fetchingFromKS: '正在获取…',
      importFromKT: '从 Kicktraq 导入',
      importingFromKT: '正在导入…',
      kicktraqHint: 'Kicktraq 有历史众筹项目的逐日数据。',
      trackingSettings: '追踪设置',
      trackRewardsLabel: '奖励变更',
      trackTextDiffLabel: '文案变更',
      trackCommentsLabel: '评论数量',
      trackAILabel: 'AI 分析',
      updateFreq: '更新频率：',
      every4h: '每 4 小时',
      every1h: '每 1 小时',
      liveCurve: '数字曲线',
      simulatedCurve: '数字曲线',
      noRealDataYet: '（暂无真实数据）',
      chartAll: '全部',
      amountPledgedLabel: '已筹款金额（美元）',
      backersEngagement: '支持者 & 互动',
      notEnoughDataChart: '数据点不足，暂时无法生成图表。',
      syncToSeeCurve: '同步数据以查看真实数字曲线。',
      predictedFinal: '预测最终',
      predictedOfGoal: (pct: string) => `约目标 ${pct}%`,
      confidenceLevels: { low: '低置信', medium: '中置信', high: '高置信' } as Record<string, string>,
      predictionDeviation: '预测偏差',
      predictionExpected: '节奏预期',
      predictionActual: '实际累计',
      predictionDeviationLabel: '偏差（实际−预期）',
      predictionHint: '基于全库已结束项目的筹款节奏曲线（按类目）预测；每次新数据后自动修正，数据越多越准。',
      rewardTiersLabel: '奖励档位',
      limitedLabel: '限量',
      backersUnit2: '位支持者',
      leftOf: (n: number, total: number) => `${total} 中剩余 ${n}`,
      claimedPct: (n: string) => `已认领 ${n}%`,
      noRewardData: '暂无奖励数据，从 Kickstarter 同步以获取奖励信息。',
      textChangeHistoryLabel: '文案变更历史',
      noTextHistory: '暂无文案历史。',
      enableTrackingHint: '开启"文案变更"追踪并定期同步，以检测项目标题和描述的变更。',
      similarProjectsLabel: '相似项目',
      similarDesc: '根据类目、目标金额和支持者数量匹配',
      noSimilarFound: '当前数据集中未找到相似项目。',
      fundedPct: (n: string) => `完成 ${n}%`,
    },
    predict: {
      title: '项目成功预测',
      subtitle: '粘贴 Kickstarter 预热页面链接，AI 智能分析并给出项目成功预测评分',
      urlLabel: '预热页面链接',
      urlPlaceholder: 'https://www.kickstarter.com/projects/creator/project-slug',
      analyzeBtn: '开始分析',
      analyzing: '分析中...',
      stepFetch: '正在获取页面内容...',
      stepFetchDone: '页面内容获取完成',
      stepAnalyze: 'AI 正在深度分析中...',
      stepAnalyzeDone: '分析完成',
      errorInvalid: '请输入有效的 Kickstarter 页面链接',
      errorFetch: '无法获取页面，请确认链接是否正确',
      errorApi: '分析服务暂时不可用，请稍后重试',
      resultTitle: '评分结果',
      totalScore: '综合评分',
      prediction: '预测结论',
      highlights: '项目亮点',
      concerns: '风险提示',
      verdictSuccess: '较可能成功',
      verdictUncertain: '结果不确定',
      verdictFail: '成功概率较低',
      hint: '评分基于公开预热页面信息，仅供参考。实际结果受预算、营销推广、供应链等多重因素影响。',
      tryAnother: '重新分析',
      progress: '分析进度',
      dimensionScores: '维度评分',
      creatorLabel: '发起人',
      methodologyTitle: '评分算法',
      methodologyDesc: '基于公开信息的多维度独立评估体系',
    },
    auth: {
      signIn: '登录',
      createAccount: '注册',
      usernamePlaceholder: '用户名',
      emailPlaceholder: '邮箱',
      passwordPlaceholder: '密码（至少6位）',
      headerDesc: '登录后解锁完整数据访问权限',
      noAccount: '还没有账号？',
      hasAccount: '已有账号？',
      errorGeneric: '操作失败，请重试',
      logout: '退出登录',
      loginToUse: '登录后方可使用此功能',
      loginRequired: '请先登录',
      loginToFilter: '筛选、翻页等操作需要登录',
      loginToAnalyze: '登录后方可使用 AI 预测功能',
      loginToFavorite: '登录后方可收藏项目',
      unlockSection: '登录查看完整内容',
      unlockHint: '登录后解锁完整数据、筛选与排行榜。',
    },
    favorites: {
      title: '我的收藏',
      subtitle: '你标记的重点项目',
      empty: '还没有收藏任何项目',
      emptyHint: '在项目列表或详情页点击 ♥ 按钮即可收藏',
      remove: '取消收藏',
    },
    landing: {
      tagline: 'Kickstarter 数据，洞察未来',
      subtitle: '深度分析 20 万+ Kickstarter 众筹项目历史数据，发现规律，预测成功',
      cta: '进入数据面板',
      learnMore: '了解更多',
      stats: { projects: '历史项目', rate: '平均成功率', raised: '累计融资', categories: '品类' },
      feature1Title: '项目探索',
      feature1Desc: '搜索并筛选 20 万+ Kickstarter 项目，按融资额、支持人数等多维度排序，支持 CSV 导出。',
      feature2Title: '深度分析',
      feature2Desc: '从类目、月度趋势、国家等多维度深入分析，内置时间范围筛选，支持自定义区间。',
      feature3Title: 'AI 预测',
      feature3Desc: '粘贴 Kickstarter 预热页面链接，AI 从品牌、概念、市场、预热和风险五个维度给出评分。',
      loginStatus: '已登录为',
      nav: { dashboard: '数据面板', about: '关于' },
    },
    analysis: {
      title: '数据分析',
      subtitle: '从类目、趋势、国家三个维度深入分析 Kickstarter 众筹数据',
      tabCategories: '类目分析',
      tabTrends: '趋势分析',
      tabCountries: '国家分析',
      period: '时间范围',
      allTime: '全部时间',
      customRange: '自定义',
      from: '开始日期',
      to: '结束日期',
    },
  },
  en: {
    nav: {
      subtitle: 'Kickstarter Data Platform',
      overview: 'Overview',
      projects: 'Projects',
      predict: 'Predict',
      analysis: 'Analysis',
      categories: 'Categories',
      trends: 'Trends',
      countries: 'Countries',
      sync: 'Sync',
      about: 'About',
      github: 'GitHub',
      leaderboard: 'Leaderboard',
      awards: 'Awards',
      liveIntel: 'Live Intel',
      favorites: 'Favorites',
      apiAccess: 'API / MCP Access',
      mcpDocs: 'Docs',
      dataQuality: 'Data Quality',
      analytics: 'Analytics',
      users: 'Users',
      updates: 'Updates',
      globalConfig: 'Global Config',
      adminViews: 'Admin Views',
    },
    dashboard: {
      title: 'Overview',
      subtitle: 'Kickstarter crowdfunding platform analytics',
      totalProjects: 'Total Projects',
      totalProjectsSub: 'Platform lifetime total',
      successRate: 'Success Rate',
      successRateSub: (n: string) => `${n} projects succeeded`,
      totalRaised: 'Total Raised',
      totalRaisedSub: 'USD, all-time',
      avgBackers: 'Avg Backers',
      avgBackersSub: 'per project average',
      statusDist: 'Project Status Distribution',
      categoryRate: 'Success Rate by Category (Top 12)',
      trendTitle: '24-Month Launch Trend',
      trendSuccessTitle: '24-Month Success Rate Trend',
      launches: 'Launches',
      successes: 'Successes',
      successRatePct: 'Success Rate (%)',
      categoryCount: 'Projects by Category (Top 12)',
      totalCount: 'Total Projects',
      successCount: 'Successful Projects',
    },
    states: {
      successful: 'Successful',
      failed: 'Failed',
      live: 'Live',
      canceled: 'Canceled',
      suspended: 'Suspended',
      prelaunch: 'Prelaunch',
    },
    categories: {
      title: 'Category Analysis',
      subtitle: 'Success rate and funding by category (completed projects only)',
      chartRate: 'Success Rate by Category',
      chartRaised: 'Total Raised by Category',
      chartDist: 'Project Distribution by Category',
      tableTitle: 'Category Details',
      colCategory: 'Category',
      colTotal: 'Total',
      colSuccess: 'Success',
      colFailed: 'Failed',
      colRate: 'Rate',
      colRaised: 'Raised',
      colAvg: 'Avg Raised',
      colBackers: 'Backers',
      total: 'Total',
      successful: 'Successful',
      failed: 'Failed',
      rate: 'Rate (%)',
      raised: 'Raised (M USD)',
    },
    trends: {
      title: 'Trend Analysis',
      subtitle: '36-month Kickstarter monthly trends (completed projects only)',
      months: 'Months',
      monthsUnit: ' months',
      totalProjects: 'Total Projects',
      avgSuccess: 'Avg Success Rate',
      peakMonth: 'Peak Month',
      chartTitle: 'Monthly Launches & Successes',
      launches: 'Launches',
      successes: 'Successes',
      rateTitle: 'Monthly Success Rate',
      raisedTitle: 'Monthly Amount Raised',
      raisedName: 'Raised (M USD)',
      successRate: 'Success Rate (%)',
      tableTitle: 'Monthly Details',
      colMonth: 'Month',
      colLaunches: 'Launches',
      colSuccess: 'Successful',
      colRate: 'Rate',
      colRaised: 'Raised',
      colShare: 'Share',
    },
    countries: {
      title: 'Country Analysis',
      subtitle: 'Crowdfunding performance by country (completed projects only)',
      chartCount: 'Projects Top 10 Countries',
      chartRate: 'Success Rate Top 10 Countries',
      chartRaised: 'Amount Raised Top 10 Countries',
      tableTitle: 'Country Details',
      colRank: 'Rank',
      colCountry: 'Country',
      colTotal: 'Total',
      colSuccess: 'Successful',
      colRate: 'Rate',
      colRaised: 'Raised',
      colBackers: 'Backers',
      total: 'Total',
      successful: 'Successful',
      rate: 'Rate (%)',
      raised: 'Raised (M USD)',
    },
    projects: {
      title: 'Projects',
      subtitle: 'Search and filter Kickstarter campaigns',
      period: 'Launch Period',
      searchLabel: 'Search',
      searchPlaceholder: 'Name or description...',
      statusLabel: 'Status',
      categoryLabel: 'Category',
      countryLabel: 'Country',
      sortLabel: 'Sort',
      searchBtn: 'Search',
      exportSelected: (n: number) => `Export (${n})`,
      exportPage: 'Export Page',
      total: (n: string) => `${n} projects`,
      pageOf: (p: number, t: number) => `Page ${p} of ${t}`,
      colName: 'Project',
      colStatus: 'Status',
      colCategory: 'Category',
      colGoal: 'Goal',
      colPledged: 'Pledged',
      colFunded: 'Funded',
      colBackers: 'Backers',
      colDays: 'Days',
      colCountry: 'Country',
      colLaunch: 'Launched',
      periods: {
        all: 'All Time',
        week: 'Last Week',
        month: 'Last Month',
        year: 'Last Year',
        custom: 'Custom',
      },
      sorts: {
        usd_pledged: 'Amount Raised',
        backers: 'Backers',
        funding_rate: 'Funding Rate',
        launched: 'Newest',
      },
      states: {
        all: 'All',
        live: 'Live',
        prelaunch: 'Prelaunch',
        successful: 'Successful',
        failed: 'Failed',
        canceled: 'Canceled',
        suspended: 'Suspended',
      },
      allCategories: 'All Categories',
      allCountries: 'All Countries',
      staffPick: 'Staff Pick',
    },
    settings: {
      title: 'Data Sync',
      subtitle: 'Manage all three data source sync pipelines',
      dbStatus: 'Database Status',
      projectCount: 'Total Projects',
      lastSync: 'Last Synced',
      manualSync: 'Manual Sync',
      dataSource: 'Data Source',
      syncDesc: 'Downloads the latest webrobots.io dataset (~100 MB compressed, ~2M records) and writes to local SQLite. Sync takes 5–15 minutes — do not close the app.',
      autoSync: 'Auto-sync: checks webrobots daily at 4am and only downloads when a new dataset is available.',
      syncBtn: 'Sync Now',
      syncing: 'Syncing...',
      imported: (n: string) => `Imported: ${n} records`,
      history: 'Sync History',
      success: 'Success',
      failed: 'Failed',
      duration: (d: string) => `Duration: ${d}`,
      records: (n: string) => `Imported ${n} records`,
      infoTitle: 'About the Data',
      infoItems: [
        'Source: webrobots.io monthly Kickstarter full snapshots',
        'Format: CSV (ZIP-compressed), 20+ fields per project',
        'History: March 2016 to present, one snapshot per month',
        'Auto-sync: checks for a new dataset on server startup and daily at 4am',
        'Database: Local SQLite at data/kickstarter.db',
        'KS Live: auto-runs every 2h to discover new projects from Kickstarter discover page',
        'Kicktraq: auto-runs every 6h, deduplicates against existing records before inserting',
      ],
      // Live sync
      liveSync: 'KS Live Discovery',
      liveSyncDesc: 'Scrapes the Kickstarter discover page (sorted by newest) to find projects launched after the last webrobots snapshot.',
      liveSyncBtn: 'Fetch Now',
      liveSyncing: 'Fetching...',
      liveSyncAuto: 'Auto-runs every 2 hours in the background, fetching projects from the last 3 days.',
      liveSyncPages: 'Pages to fetch',
      liveSyncState: 'Project state',
      liveSyncStateAll: 'All',
      liveSyncStateLive: 'Live',
      liveSyncStateSuccessful: 'Successful',
      // Kicktraq sync
      kicktraqSync: 'Kicktraq Active Projects',
      kicktraqSyncDesc: 'Scrapes the Kicktraq active projects list to supplement KS direct scraping coverage.',
      kicktraqSyncBtn: 'Fetch Now',
      kicktraqSyncing: 'Fetching...',
      kicktraqSyncAuto: 'Auto-runs every 6 hours in the background.',
      kicktraqPages: 'Pages to fetch',
    },
    projectDetail: {
      loading: 'Loading...',
      notFound: 'Project not found',
      backToList: 'Back to list',
      back: 'Back to projects',
      staffPick: 'Staff Pick',
      createdBy: (name: string) => `by ${name}`,
      fundingOf: (goal: string) => `of ${goal} goal`,
      goalLabel: (goal: string) => `Goal: ${goal}`,
      exceeded: 'Goal exceeded',
      belowGoal: 'Below goal',
      backers: 'Backers',
      backersUnit: (n: string) => n,
      goal: 'Goal',
      duration: 'Duration',
      daysUnit: (n: number) => `${n} days`,
      dailyAvg: 'Daily Avg',
      timeline: 'Timeline',
      timelineCreated: 'Created',
      timelineLaunched: 'Launched',
      timelineDeadline: 'Deadline',
      curveName: 'Numeric Curves (Simulated)',
      curveNote: 'Simulated estimate based on typical Kickstarter campaign patterns (fast start → steady middle → end sprint). Not real daily data.',
      dayFirst: 'Day 1',
      dayMid: (n: number) => `Day ${n}`,
      dayLast: (n: number) => `Day ${n}`,
      legendMet: 'Goal met ≥ 100%',
      legendBelow: 'Below goal',
      dataTitle: 'About the data:',
      dataBody: 'Data comes from webrobots.io static Kickstarter snapshots — final project state only, no daily funding history. For real daily trends, visit',
      dataBody2: '. Kicksonar will support daily data collection in a future version.',
      // Social Blade style detail page
      tabOverview: 'Overview',
      tabCurve: 'Numeric Curves',
      tabRewards: 'Rewards',
      tabChanges: 'Text Changes',
      tabCollaborators: 'Collaborators',
      tabSimilar: 'Similar Projects',
      pledgedOf: (goal: string) => `pledged of ${goal}`,
      fundedLabel: 'funded',
      backersLabel: 'backers',
      dayCampaign: 'day campaign',
      avgPerDay: 'avg/day',
      saved: 'Saved',
      saveBtn: 'Save',
      trackingBtn: 'Tracking',
      trackBtn: 'Track',
      syncingBtn: 'Syncing…',
      syncNow: 'Sync Now',
      lastSynced: 'Last synced',
      fundingGrade: 'Funding Grade',
      fundingRateLabel: 'Funding Rate',
      totalRaisedLabel: 'Total Raised',
      goalPrefix: (goal: string) => `Goal: ${goal}`,
      dayAvgSuffix: '/day avg',
      snapshotTitle: 'Daily Snapshot History',
      snapshotRecords: (n: number) => `${n} records`,
      colDate: 'Date',
      colPledged: 'Pledged',
      colChange: 'Change',
      colBackers: 'Backers',
      colDelta: '+/-',
      colDaysLeft: 'Days Left',
      colComments: 'Comments',
      colUpdates: 'Updates',
      colSource: 'Source',
      noHistoricalData: 'No historical data yet for this project.',
      fetchFromKS: 'Fetch from Kickstarter',
      fetchingFromKS: 'Fetching…',
      importFromKT: 'Import from Kicktraq',
      importingFromKT: 'Importing from Kicktraq…',
      kicktraqHint: 'Kicktraq has historical data for past campaigns.',
      trackingSettings: 'Tracking Settings',
      trackRewardsLabel: 'Rewards',
      trackTextDiffLabel: 'Text Changes',
      trackCommentsLabel: 'Comment Count',
      trackAILabel: 'AI Analysis',
      updateFreq: 'Update frequency:',
      every4h: 'Every 4h',
      every1h: 'Every 1h',
      liveCurve: 'Numeric Curves',
      simulatedCurve: 'Numeric Curves',
      noRealDataYet: '(no real data yet)',
      chartAll: 'All',
      amountPledgedLabel: 'Amount Pledged (USD)',
      backersEngagement: 'Backers & Engagement',
      notEnoughDataChart: 'Not enough data points for a chart yet.',
      syncToSeeCurve: 'Sync data to see the real funding curve.',
      predictedFinal: 'Predicted final',
      predictedOfGoal: (pct: string) => `~${pct}% of goal`,
      confidenceLevels: { low: 'Low', medium: 'Medium', high: 'High' } as Record<string, string>,
      predictionDeviation: 'Prediction deviation',
      predictionExpected: 'Expected (pace)',
      predictionActual: 'Actual',
      predictionDeviationLabel: 'Deviation (actual − expected)',
      predictionHint: 'Predicted from the funding-pace curve learned across all completed projects (by category); auto-corrects on each new data point and sharpens as data grows.',
      rewardTiersLabel: 'Reward Tiers',
      limitedLabel: 'Limited',
      backersUnit2: 'backers',
      leftOf: (n: number, total: number) => `${n} left of ${total}`,
      claimedPct: (n: string) => `${n}% claimed`,
      noRewardData: 'No reward data yet. Sync from Kickstarter to fetch rewards.',
      textChangeHistoryLabel: 'Text Change History',
      noTextHistory: 'No text history yet.',
      enableTrackingHint: 'Enable "Text Changes" tracking and sync periodically to detect changes to the project\'s title and description.',
      similarProjectsLabel: 'Similar Projects',
      similarDesc: 'Matched by category, goal size, and backer count',
      noSimilarFound: 'No similar projects found in the current dataset.',
      fundedPct: (n: string) => `${n}% funded`,
    },
    predict: {
      title: 'Campaign Prediction',
      subtitle: 'Paste a Kickstarter pre-launch page URL for AI-powered success prediction and scoring',
      urlLabel: 'Pre-launch Page URL',
      urlPlaceholder: 'https://www.kickstarter.com/projects/creator/project-slug',
      analyzeBtn: 'Analyze',
      analyzing: 'Analyzing...',
      stepFetch: 'Fetching page content...',
      stepFetchDone: 'Page content retrieved',
      stepAnalyze: 'AI deep analysis in progress...',
      stepAnalyzeDone: 'Analysis complete',
      errorInvalid: 'Please enter a valid Kickstarter page URL',
      errorFetch: 'Could not fetch the page. Please verify the URL.',
      errorApi: 'Analysis service temporarily unavailable. Please try again.',
      resultTitle: 'Score Results',
      totalScore: 'Overall Score',
      prediction: 'Prediction',
      highlights: 'Highlights',
      concerns: 'Concerns',
      verdictSuccess: 'Likely to Succeed',
      verdictUncertain: 'Outcome Uncertain',
      verdictFail: 'Low Success Probability',
      hint: 'Score is based on publicly available page information and is for reference only. Actual results depend on budget, marketing, supply chain, and other factors.',
      tryAnother: 'Analyze Another',
      progress: 'Analysis Progress',
      dimensionScores: 'Dimension Scores',
      creatorLabel: 'Creator',
      methodologyTitle: 'Scoring Methodology',
      methodologyDesc: 'Multi-dimensional independent assessment based on public information',
    },
    auth: {
      signIn: 'Sign In',
      createAccount: 'Create Account',
      usernamePlaceholder: 'Username',
      emailPlaceholder: 'Email',
      passwordPlaceholder: 'Password (min. 6 chars)',
      headerDesc: 'Sign in to unlock full data access',
      noAccount: "Don't have an account?",
      hasAccount: 'Already have an account?',
      errorGeneric: 'Something went wrong. Please try again.',
      logout: 'Sign Out',
      loginToUse: 'Sign in to use this feature',
      loginRequired: 'Sign in required',
      loginToFilter: 'Sign in to filter, sort, or browse past page 1',
      loginToAnalyze: 'Sign in to use AI prediction',
      loginToFavorite: 'Sign in to save favorites',
      unlockSection: 'Sign in to view the full content',
      unlockHint: 'Sign in to unlock full data, filters and leaderboards.',
    },
    favorites: {
      title: 'Favorites',
      subtitle: 'Your saved projects',
      empty: 'No favorites yet',
      emptyHint: 'Click the ♥ button on any project to save it here',
      remove: 'Remove',
    },
    landing: {
      tagline: 'Kickstarter Data, Decoded',
      subtitle: 'Discover patterns and opportunities hidden in 200,000+ Kickstarter campaign records',
      cta: 'Go to Dashboard',
      learnMore: 'Learn More',
      stats: { projects: 'Campaigns', rate: 'Success Rate', raised: 'Total Raised', categories: 'Categories' },
      feature1Title: 'Project Explorer',
      feature1Desc: 'Search and filter 200k+ Kickstarter campaigns by keyword, status, category, and country. Sort, paginate, and export to CSV.',
      feature2Title: 'Deep Analysis',
      feature2Desc: 'Drill into category performance, monthly trends, and country breakdowns. Unified time-range filter with custom date support.',
      feature3Title: 'AI Prediction',
      feature3Desc: 'Paste a Kickstarter pre-launch URL and get an AI-powered 5-dimension score: brand, concept, market, pre-launch, and risk.',
      loginStatus: 'Signed in as',
      nav: { dashboard: 'Dashboard', about: 'About' },
    },
    analysis: {
      title: 'Analysis',
      subtitle: 'Deep-dive into Kickstarter data by category, trend, and country',
      tabCategories: 'Categories',
      tabTrends: 'Trends',
      tabCountries: 'Countries',
      period: 'Time Range',
      allTime: 'All Time',
      customRange: 'Custom',
      from: 'From',
      to: 'To',
    },
  },
};

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: any[]) => any
    ? T[K]
    : T[K] extends readonly any[]
      ? T[K]
      : T[K] extends object
        ? DeepPartial<T[K]>
        : T[K];
};

type LocaleTree = typeof baseT.en;

function isMergeable(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeLocale<T>(base: T, overrides: DeepPartial<T>): T {
  if (!isMergeable(base) || !isMergeable(overrides)) return (overrides ?? base) as T;
  const next: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(overrides)) {
    const current = next[key];
    next[key] = isMergeable(current) && isMergeable(value)
      ? mergeLocale(current, value as DeepPartial<typeof current>)
      : value;
  }
  return next as T;
}

const localeOverrides: Record<Exclude<Lang, 'en' | 'cn'>, DeepPartial<LocaleTree>> = {
  'zh-tw': {
    nav: {
      subtitle: 'Kickstarter 數據平台',
      overview: '數據概覽',
      projects: '項目列表',
      predict: '項目預測',
      analysis: '數據分析',
      categories: '類目分析',
      trends: '趨勢分析',
      countries: '國家分析',
      sync: '數據同步',
      about: '關於 Kicksonar',
      leaderboard: '排行榜',
      awards: '聲納獎',
      liveIntel: 'Live 情報',
      favorites: '收藏夾',
      apiAccess: 'API / MCP 接入',
      mcpDocs: '使用文檔',
      dataQuality: '數據品質',
      analytics: '站點分析',
      users: '用戶看板',
      updates: '更新推送',
      globalConfig: '全域配置',
      adminViews: '管理員視圖',
    },
    states: {
      successful: '成功',
      failed: '失敗',
      live: '進行中',
      canceled: '已取消',
      suspended: '已暫停',
      prelaunch: '預熱中',
    },
    projects: {
      title: '項目列表',
      subtitle: '搜尋和篩選 Kickstarter 眾籌項目',
      period: '發起時間',
      searchLabel: '搜尋',
      searchPlaceholder: '名稱或描述...',
      statusLabel: '狀態',
      categoryLabel: '類目',
      countryLabel: '國家',
      sortLabel: '排序',
      searchBtn: '搜尋',
      exportSelected: (n: number) => `匯出 (${n})`,
      exportPage: '匯出本頁',
      total: (n: string) => `${n} 個項目`,
      pageOf: (p: number, total: number) => `第 ${p} 頁 / 共 ${total} 頁`,
      colName: '項目',
      colStatus: '狀態',
      colCategory: '類目',
      colGoal: '目標',
      colPledged: '已籌',
      colFunded: '完成率',
      colBackers: '支持者',
      colDays: '天數',
      colCountry: '國家',
      colLaunch: '發起',
      periods: { all: '全部時間', week: '最近一週', month: '最近一月', year: '最近一年', custom: '自訂' },
      sorts: { usd_pledged: '眾籌金額', backers: '支持者', funding_rate: '完成率', launched: '最新發起' },
      states: { all: '全部', live: '進行中', prelaunch: '預熱中', successful: '成功', failed: '失敗', canceled: '已取消', suspended: '已暫停' },
      allCategories: '全部類目',
      allCountries: '全部國家',
      staffPick: '精選',
    },
    auth: {
      signIn: '登入',
      createAccount: '建立帳戶',
      emailPlaceholder: '電子郵件',
      passwordPlaceholder: '密碼（至少 6 位）',
      headerDesc: '登入後解鎖完整數據權限',
      noAccount: '還沒有帳戶？',
      hasAccount: '已有帳戶？',
      errorGeneric: '操作失敗，請重試。',
      logout: '登出',
      loginToUse: '登入後即可使用此功能',
      loginRequired: '請先登入',
      loginToFilter: '登入後可篩選、排序或瀏覽更多頁',
      loginToAnalyze: '登入後可使用 AI 預測',
      loginToFavorite: '登入後可收藏項目',
      unlockSection: '登入查看完整內容',
      unlockHint: '登入後解鎖完整數據、篩選與排行榜。',
    },
    favorites: { title: '收藏夾', subtitle: '你保存的項目', empty: '尚未收藏任何項目', emptyHint: '在項目列表或詳情頁點擊 ♥ 即可收藏', remove: '移除' },
    landing: {
      tagline: 'Kickstarter 數據，洞察未來',
      subtitle: '探索 200,000+ Kickstarter 眾籌項目中的模式與機會',
      cta: '進入數據面板',
      learnMore: '了解更多',
      stats: { projects: '眾籌項目', rate: '成功率', raised: '累計籌資', categories: '類目' },
      feature1Title: '項目探索',
      feature1Desc: '按關鍵字、狀態、類目與國家搜尋和篩選 Kickstarter 項目。',
      feature2Title: '深度分析',
      feature2Desc: '深入查看類目表現、月度趨勢與國家分佈。',
      feature3Title: 'AI 預測',
      feature3Desc: '貼上 Kickstarter 預熱頁連結，獲得 AI 五維度評分。',
      loginStatus: '已登入為',
      nav: { dashboard: '數據面板', about: '關於' },
    },
    analysis: {
      title: '數據分析',
      subtitle: '從類目、趨勢與國家三個維度深入分析 Kickstarter 數據',
      tabCategories: '類目',
      tabTrends: '趨勢',
      tabCountries: '國家',
      period: '時間範圍',
      allTime: '全部時間',
      customRange: '自訂',
      from: '開始',
      to: '結束',
    },
    predict: {
      title: '項目成功預測',
      subtitle: '貼上 Kickstarter 預熱頁連結，獲得 AI 成功率評分',
      analyzeBtn: '開始分析',
      analyzing: '分析中...',
      errorInvalid: '請輸入有效的 Kickstarter 連結',
      resultTitle: '評分結果',
      totalScore: '綜合評分',
      prediction: '預測結論',
      highlights: '亮點',
      concerns: '風險',
      tryAnother: '重新分析',
    },
  },
  ja: {
    nav: {
      subtitle: 'Kickstarter データプラットフォーム',
      overview: '概要',
      projects: 'プロジェクト',
      predict: '予測',
      analysis: '分析',
      categories: 'カテゴリ',
      trends: 'トレンド',
      countries: '国別分析',
      sync: '同期',
      about: 'Kicksonar について',
      leaderboard: 'ランキング',
      awards: 'Sonar Awards',
      liveIntel: 'Live 情報',
      favorites: 'お気に入り',
      dataQuality: 'データ品質',
      analytics: 'アナリティクス',
      users: 'ユーザー',
      updates: '更新',
      globalConfig: '全体設定',
      adminViews: '管理者ビュー',
    },
    states: { successful: '成功', failed: '失敗', live: '進行中', canceled: 'キャンセル', suspended: '停止', prelaunch: '公開前' },
    categories: { title: 'カテゴリ分析', subtitle: 'カテゴリ別の成功率と調達額', chartRate: 'カテゴリ別成功率', chartRaised: 'カテゴリ別調達額', chartDist: 'カテゴリ分布', tableTitle: 'カテゴリ詳細', colCategory: 'カテゴリ', colTotal: '合計', colSuccess: '成功', colFailed: '失敗', colRate: '率', colRaised: '調達額', colAvg: '平均調達額', colBackers: '支援者', total: '合計', successful: '成功', failed: '失敗', rate: '率 (%)', raised: '調達額 (M USD)' },
    trends: { title: 'トレンド分析', subtitle: 'Kickstarter の月次トレンド', months: '月数', monthsUnit: ' か月', totalProjects: '合計プロジェクト', avgSuccess: '平均成功率', peakMonth: 'ピーク月', chartTitle: '月次ローンチと成功数', launches: 'ローンチ', successes: '成功', rateTitle: '月次成功率', raisedTitle: '月次調達額', raisedName: '調達額 (M USD)', successRate: '成功率 (%)', tableTitle: '月次詳細', colMonth: '月', colLaunches: 'ローンチ', colSuccess: '成功', colRate: '率', colRaised: '調達額', colShare: '比率' },
    countries: { title: '国別分析', subtitle: '国・地域別のクラウドファンディング実績', chartCount: 'プロジェクト数 上位10か国', chartRate: '成功率 上位10か国', chartRaised: '調達額 上位10か国', tableTitle: '国別詳細', colRank: '順位', colCountry: '国/地域', colTotal: '合計', colSuccess: '成功', colRate: '率', colRaised: '調達額', colBackers: '支援者', total: '合計', successful: '成功', rate: '率 (%)', raised: '調達額 (M USD)' },
    projects: { title: 'プロジェクト', subtitle: 'Kickstarter キャンペーンを検索・絞り込み', period: '開始期間', searchLabel: '検索', searchPlaceholder: '名前または説明...', statusLabel: '状態', categoryLabel: 'カテゴリ', countryLabel: '国', sortLabel: '並び替え', searchBtn: '検索', exportSelected: (n: number) => `エクスポート (${n})`, exportPage: 'このページを出力', total: (n: string) => `${n} 件`, pageOf: (p: number, total: number) => `${p} / ${total} ページ`, colName: 'プロジェクト', colStatus: '状態', colCategory: 'カテゴリ', colGoal: '目標', colPledged: '調達額', colFunded: '達成率', colBackers: '支援者', colDays: '日数', colCountry: '国', colLaunch: '開始日', periods: { all: '全期間', week: '直近1週間', month: '直近1か月', year: '直近1年', custom: 'カスタム' }, sorts: { usd_pledged: '調達額', backers: '支援者', funding_rate: '達成率', launched: '新着順' }, states: { all: 'すべて', live: '進行中', prelaunch: '公開前', successful: '成功', failed: '失敗', canceled: 'キャンセル', suspended: '停止' }, allCategories: 'すべてのカテゴリ', allCountries: 'すべての国', staffPick: 'Staff Pick' },
    auth: { signIn: 'ログイン', createAccount: 'アカウント作成', emailPlaceholder: 'メール', passwordPlaceholder: 'パスワード（6文字以上）', headerDesc: 'ログインして全データを表示', noAccount: 'アカウントをお持ちでないですか？', hasAccount: 'すでにアカウントがありますか？', errorGeneric: '問題が発生しました。もう一度お試しください。', logout: 'ログアウト', loginToUse: 'この機能を使うにはログインしてください', loginRequired: 'ログインが必要です', loginToFilter: '絞り込み・並び替え・追加ページにはログインが必要です', loginToAnalyze: 'AI 予測にはログインが必要です', loginToFavorite: 'お気に入りにはログインが必要です', unlockSection: 'ログインして全文を表示', unlockHint: 'ログインするとデータ、フィルタ、ランキングが利用できます。' },
    favorites: { title: 'お気に入り', subtitle: '保存したプロジェクト', empty: 'お気に入りはまだありません', emptyHint: 'プロジェクトで ♥ をクリックして保存します', remove: '削除' },
    landing: { tagline: 'Kickstarter データを読み解く', subtitle: '200,000件以上の Kickstarter キャンペーンから傾向と機会を発見', cta: 'ダッシュボードへ', learnMore: '詳しく見る', stats: { projects: 'キャンペーン', rate: '成功率', raised: '総調達額', categories: 'カテゴリ' }, feature1Title: 'プロジェクト探索', feature1Desc: 'キーワード、状態、カテゴリ、国で検索・絞り込みできます。', feature2Title: '詳細分析', feature2Desc: 'カテゴリ、月次トレンド、国別データを深掘りできます。', feature3Title: 'AI 予測', feature3Desc: 'Kickstarter の公開前ページを貼り付け、AI による5軸スコアを取得します。', loginStatus: 'ログイン中', nav: { dashboard: 'ダッシュボード', about: '概要' } },
    analysis: { title: '分析', subtitle: 'カテゴリ、トレンド、国別に Kickstarter データを分析', tabCategories: 'カテゴリ', tabTrends: 'トレンド', tabCountries: '国', period: '期間', allTime: '全期間', customRange: 'カスタム', from: '開始', to: '終了' },
    predict: { title: 'キャンペーン予測', subtitle: 'Kickstarter 公開前ページの URL を貼り付けて成功可能性を評価', analyzeBtn: '分析', analyzing: '分析中...', errorInvalid: '有効な Kickstarter URL を入力してください', resultTitle: 'スコア結果', totalScore: '総合スコア', prediction: '予測', highlights: '強み', concerns: '懸念', tryAnother: 'もう一度分析' },
  },
  ko: {
    nav: { subtitle: 'Kickstarter 데이터 플랫폼', overview: '개요', projects: '프로젝트', predict: '예측', analysis: '분석', categories: '카테고리', trends: '트렌드', countries: '국가 분석', sync: '동기화', about: 'Kicksonar 소개', leaderboard: '리더보드', awards: 'Sonar Awards', liveIntel: 'Live 인텔', favorites: '즐겨찾기', dataQuality: '데이터 품질', analytics: '분석', users: '사용자', updates: '업데이트', globalConfig: '전역 설정', adminViews: '관리자 보기' },
    states: { successful: '성공', failed: '실패', live: '진행 중', canceled: '취소됨', suspended: '중지됨', prelaunch: '출시 전' },
    projects: { title: '프로젝트', subtitle: 'Kickstarter 캠페인을 검색하고 필터링', period: '출시 기간', searchLabel: '검색', searchPlaceholder: '이름 또는 설명...', statusLabel: '상태', categoryLabel: '카테고리', countryLabel: '국가', sortLabel: '정렬', searchBtn: '검색', exportSelected: (n: number) => `내보내기 (${n})`, exportPage: '현재 페이지 내보내기', total: (n: string) => `${n}개 프로젝트`, pageOf: (p: number, total: number) => `${p}/${total} 페이지`, colName: '프로젝트', colStatus: '상태', colCategory: '카테고리', colGoal: '목표', colPledged: '모금액', colFunded: '달성률', colBackers: '후원자', colDays: '일수', colCountry: '국가', colLaunch: '출시일', periods: { all: '전체 기간', week: '지난 1주', month: '지난 1개월', year: '지난 1년', custom: '사용자 지정' }, sorts: { usd_pledged: '모금액', backers: '후원자', funding_rate: '달성률', launched: '최신순' }, states: { all: '전체', live: '진행 중', prelaunch: '출시 전', successful: '성공', failed: '실패', canceled: '취소됨', suspended: '중지됨' }, allCategories: '모든 카테고리', allCountries: '모든 국가', staffPick: '스태프 픽' },
    auth: { signIn: '로그인', createAccount: '계정 만들기', emailPlaceholder: '이메일', passwordPlaceholder: '비밀번호(6자 이상)', headerDesc: '로그인하여 전체 데이터 보기', noAccount: '계정이 없나요?', hasAccount: '이미 계정이 있나요?', errorGeneric: '문제가 발생했습니다. 다시 시도하세요.', logout: '로그아웃', loginToUse: '이 기능을 사용하려면 로그인하세요', loginRequired: '로그인이 필요합니다', loginToFilter: '필터, 정렬, 추가 페이지는 로그인이 필요합니다', loginToAnalyze: 'AI 예측은 로그인이 필요합니다', loginToFavorite: '저장하려면 로그인하세요', unlockSection: '로그인하여 전체 내용 보기', unlockHint: '로그인하면 전체 데이터, 필터, 리더보드를 사용할 수 있습니다.' },
    favorites: { title: '즐겨찾기', subtitle: '저장한 프로젝트', empty: '아직 즐겨찾기가 없습니다', emptyHint: '프로젝트에서 ♥ 버튼을 눌러 저장하세요', remove: '삭제' },
    landing: { tagline: 'Kickstarter 데이터를 해석하다', subtitle: '200,000개 이상의 Kickstarter 캠페인에서 패턴과 기회를 발견하세요', cta: '대시보드로 이동', learnMore: '더 알아보기', stats: { projects: '캠페인', rate: '성공률', raised: '총 모금액', categories: '카테고리' }, feature1Title: '프로젝트 탐색', feature1Desc: '키워드, 상태, 카테고리, 국가로 검색하고 필터링합니다.', feature2Title: '심층 분석', feature2Desc: '카테고리 성과, 월별 트렌드, 국가별 분포를 분석합니다.', feature3Title: 'AI 예측', feature3Desc: 'Kickstarter 사전 공개 URL을 붙여넣고 AI 5차원 점수를 확인합니다.', loginStatus: '로그인됨', nav: { dashboard: '대시보드', about: '소개' } },
    analysis: { title: '분석', subtitle: '카테고리, 트렌드, 국가별 Kickstarter 데이터 분석', tabCategories: '카테고리', tabTrends: '트렌드', tabCountries: '국가', period: '기간', allTime: '전체 기간', customRange: '사용자 지정', from: '시작', to: '종료' },
    predict: { title: '캠페인 예측', subtitle: 'Kickstarter 사전 공개 페이지 URL로 성공 가능성을 평가합니다', analyzeBtn: '분석', analyzing: '분석 중...', errorInvalid: '유효한 Kickstarter URL을 입력하세요', resultTitle: '점수 결과', totalScore: '종합 점수', prediction: '예측', highlights: '강점', concerns: '우려', tryAnother: '다시 분석' },
  },
  de: {
    nav: { subtitle: 'Kickstarter-Datenplattform', overview: 'Überblick', projects: 'Projekte', predict: 'Prognose', analysis: 'Analyse', categories: 'Kategorien', trends: 'Trends', countries: 'Länder', sync: 'Sync', about: 'Über Kicksonar', leaderboard: 'Bestenliste', awards: 'Sonar Awards', liveIntel: 'Live Intel', favorites: 'Favoriten', dataQuality: 'Datenqualität', analytics: 'Analytics', users: 'Nutzer', updates: 'Updates', globalConfig: 'Globale Konfig.', adminViews: 'Admin-Ansichten' },
    states: { successful: 'Erfolgreich', failed: 'Gescheitert', live: 'Live', canceled: 'Abgebrochen', suspended: 'Pausiert', prelaunch: 'Prelaunch' },
    projects: { title: 'Projekte', subtitle: 'Kickstarter-Kampagnen suchen und filtern', period: 'Startzeitraum', searchLabel: 'Suche', searchPlaceholder: 'Name oder Beschreibung...', statusLabel: 'Status', categoryLabel: 'Kategorie', countryLabel: 'Land', sortLabel: 'Sortieren', searchBtn: 'Suchen', exportSelected: (n: number) => `Exportieren (${n})`, exportPage: 'Seite exportieren', total: (n: string) => `${n} Projekte`, pageOf: (p: number, total: number) => `Seite ${p} von ${total}`, colName: 'Projekt', colStatus: 'Status', colCategory: 'Kategorie', colGoal: 'Ziel', colPledged: 'Finanziert', colFunded: 'Quote', colBackers: 'Unterstützer', colDays: 'Tage', colCountry: 'Land', colLaunch: 'Start', periods: { all: 'Gesamter Zeitraum', week: 'Letzte Woche', month: 'Letzter Monat', year: 'Letztes Jahr', custom: 'Benutzerdefiniert' }, sorts: { usd_pledged: 'Finanzierung', backers: 'Unterstützer', funding_rate: 'Finanzierungsquote', launched: 'Neueste' }, states: { all: 'Alle', live: 'Live', prelaunch: 'Prelaunch', successful: 'Erfolgreich', failed: 'Gescheitert', canceled: 'Abgebrochen', suspended: 'Pausiert' }, allCategories: 'Alle Kategorien', allCountries: 'Alle Länder', staffPick: 'Staff Pick' },
    auth: { signIn: 'Anmelden', createAccount: 'Konto erstellen', emailPlaceholder: 'E-Mail', passwordPlaceholder: 'Passwort (mind. 6 Zeichen)', headerDesc: 'Anmelden, um vollen Datenzugriff zu erhalten', noAccount: 'Noch kein Konto?', hasAccount: 'Bereits ein Konto?', errorGeneric: 'Etwas ist schiefgelaufen. Bitte erneut versuchen.', logout: 'Abmelden', loginToUse: 'Zum Verwenden anmelden', loginRequired: 'Anmeldung erforderlich', loginToFilter: 'Filtern, Sortieren und weitere Seiten erfordern Anmeldung', loginToAnalyze: 'AI-Prognose erfordert Anmeldung', loginToFavorite: 'Zum Speichern anmelden', unlockSection: 'Anmelden, um alles zu sehen', unlockHint: 'Anmelden für volle Daten, Filter und Bestenlisten.' },
    favorites: { title: 'Favoriten', subtitle: 'Gespeicherte Projekte', empty: 'Noch keine Favoriten', emptyHint: 'Klicke bei einem Projekt auf ♥, um es zu speichern', remove: 'Entfernen' },
    landing: { tagline: 'Kickstarter-Daten, entschlüsselt', subtitle: 'Entdecke Muster und Chancen in über 200.000 Kickstarter-Kampagnen', cta: 'Zum Dashboard', learnMore: 'Mehr erfahren', stats: { projects: 'Kampagnen', rate: 'Erfolgsquote', raised: 'Gesamtvolumen', categories: 'Kategorien' }, feature1Title: 'Projekt-Explorer', feature1Desc: 'Suche und filtere Kampagnen nach Keyword, Status, Kategorie und Land.', feature2Title: 'Tiefe Analyse', feature2Desc: 'Analysiere Kategorien, monatliche Trends und Länder-Benchmarks.', feature3Title: 'AI-Prognose', feature3Desc: 'Kickstarter-Prelaunch-URL einfügen und AI-Score erhalten.', loginStatus: 'Angemeldet als', nav: { dashboard: 'Dashboard', about: 'Über' } },
    analysis: { title: 'Analyse', subtitle: 'Kickstarter-Daten nach Kategorie, Trend und Land analysieren', tabCategories: 'Kategorien', tabTrends: 'Trends', tabCountries: 'Länder', period: 'Zeitraum', allTime: 'Gesamt', customRange: 'Benutzerdefiniert', from: 'Von', to: 'Bis' },
    predict: { title: 'Kampagnen-Prognose', subtitle: 'Kickstarter-Prelaunch-URL einfügen für eine AI-Erfolgsbewertung', analyzeBtn: 'Analysieren', analyzing: 'Analysiere...', errorInvalid: 'Bitte eine gültige Kickstarter-URL eingeben', resultTitle: 'Score-Ergebnis', totalScore: 'Gesamtscore', prediction: 'Prognose', highlights: 'Stärken', concerns: 'Risiken', tryAnother: 'Erneut analysieren' },
  },
  it: {
    nav: { subtitle: 'Piattaforma dati Kickstarter', overview: 'Panoramica', projects: 'Progetti', predict: 'Previsione', analysis: 'Analisi', categories: 'Categorie', trends: 'Trend', countries: 'Paesi', sync: 'Sync', about: 'Informazioni', leaderboard: 'Classifica', awards: 'Sonar Awards', liveIntel: 'Live Intel', favorites: 'Preferiti', dataQuality: 'Qualità dati', analytics: 'Analytics', users: 'Utenti', updates: 'Aggiornamenti', globalConfig: 'Config globale', adminViews: 'Viste admin' },
    states: { successful: 'Riuscito', failed: 'Fallito', live: 'Live', canceled: 'Annullato', suspended: 'Sospeso', prelaunch: 'Pre-lancio' },
    projects: { title: 'Progetti', subtitle: 'Cerca e filtra campagne Kickstarter', period: 'Periodo di lancio', searchLabel: 'Cerca', searchPlaceholder: 'Nome o descrizione...', statusLabel: 'Stato', categoryLabel: 'Categoria', countryLabel: 'Paese', sortLabel: 'Ordina', searchBtn: 'Cerca', exportSelected: (n: number) => `Esporta (${n})`, exportPage: 'Esporta pagina', total: (n: string) => `${n} progetti`, pageOf: (p: number, total: number) => `Pagina ${p} di ${total}`, colName: 'Progetto', colStatus: 'Stato', colCategory: 'Categoria', colGoal: 'Obiettivo', colPledged: 'Raccolto', colFunded: 'Finanziato', colBackers: 'Sostenitori', colDays: 'Giorni', colCountry: 'Paese', colLaunch: 'Lancio', periods: { all: 'Tutto il periodo', week: 'Ultima settimana', month: 'Ultimo mese', year: 'Ultimo anno', custom: 'Personalizzato' }, sorts: { usd_pledged: 'Importo raccolto', backers: 'Sostenitori', funding_rate: 'Tasso finanziamento', launched: 'Più recenti' }, states: { all: 'Tutti', live: 'Live', prelaunch: 'Pre-lancio', successful: 'Riuscito', failed: 'Fallito', canceled: 'Annullato', suspended: 'Sospeso' }, allCategories: 'Tutte le categorie', allCountries: 'Tutti i paesi', staffPick: 'Staff Pick' },
    auth: { signIn: 'Accedi', createAccount: 'Crea account', emailPlaceholder: 'Email', passwordPlaceholder: 'Password (min. 6 caratteri)', headerDesc: 'Accedi per sbloccare tutti i dati', noAccount: 'Non hai un account?', hasAccount: 'Hai già un account?', errorGeneric: 'Qualcosa è andato storto. Riprova.', logout: 'Esci', loginToUse: 'Accedi per usare questa funzione', loginRequired: 'Accesso richiesto', loginToFilter: 'Filtri, ordinamento e pagine extra richiedono accesso', loginToAnalyze: 'La previsione AI richiede accesso', loginToFavorite: 'Accedi per salvare', unlockSection: 'Accedi per vedere tutto', unlockHint: 'Accedi per dati completi, filtri e classifiche.' },
    favorites: { title: 'Preferiti', subtitle: 'I tuoi progetti salvati', empty: 'Nessun preferito', emptyHint: 'Clicca ♥ su un progetto per salvarlo qui', remove: 'Rimuovi' },
    landing: { tagline: 'Dati Kickstarter, decodificati', subtitle: 'Scopri pattern e opportunità in oltre 200.000 campagne Kickstarter', cta: 'Vai alla dashboard', learnMore: 'Scopri di più', stats: { projects: 'Campagne', rate: 'Tasso successo', raised: 'Totale raccolto', categories: 'Categorie' }, feature1Title: 'Esplora progetti', feature1Desc: 'Cerca e filtra per parola chiave, stato, categoria e paese.', feature2Title: 'Analisi profonda', feature2Desc: 'Analizza categorie, trend mensili e paesi.', feature3Title: 'Previsione AI', feature3Desc: 'Incolla una URL Kickstarter pre-lancio e ottieni un punteggio AI.', loginStatus: 'Accesso come', nav: { dashboard: 'Dashboard', about: 'Info' } },
    analysis: { title: 'Analisi', subtitle: 'Analizza i dati Kickstarter per categoria, trend e paese', tabCategories: 'Categorie', tabTrends: 'Trend', tabCountries: 'Paesi', period: 'Intervallo', allTime: 'Tutto', customRange: 'Personalizzato', from: 'Da', to: 'A' },
    predict: { title: 'Previsione campagna', subtitle: 'Incolla una pagina Kickstarter pre-lancio per una valutazione AI', analyzeBtn: 'Analizza', analyzing: 'Analisi...', errorInvalid: 'Inserisci una URL Kickstarter valida', resultTitle: 'Risultati', totalScore: 'Punteggio totale', prediction: 'Previsione', highlights: 'Punti forti', concerns: 'Rischi', tryAnother: 'Analizza di nuovo' },
  },
  fr: {
    nav: { subtitle: 'Plateforme de données Kickstarter', overview: 'Vue d’ensemble', projects: 'Projets', predict: 'Prédire', analysis: 'Analyse', categories: 'Catégories', trends: 'Tendances', countries: 'Pays', sync: 'Sync', about: 'À propos', leaderboard: 'Classement', awards: 'Sonar Awards', liveIntel: 'Live Intel', favorites: 'Favoris', dataQuality: 'Qualité des données', analytics: 'Analytics', users: 'Utilisateurs', updates: 'Mises à jour', globalConfig: 'Config globale', adminViews: 'Vues admin' },
    states: { successful: 'Réussi', failed: 'Échoué', live: 'En cours', canceled: 'Annulé', suspended: 'Suspendu', prelaunch: 'Pré-lancement' },
    projects: { title: 'Projets', subtitle: 'Rechercher et filtrer les campagnes Kickstarter', period: 'Période de lancement', searchLabel: 'Recherche', searchPlaceholder: 'Nom ou description...', statusLabel: 'Statut', categoryLabel: 'Catégorie', countryLabel: 'Pays', sortLabel: 'Trier', searchBtn: 'Rechercher', exportSelected: (n: number) => `Exporter (${n})`, exportPage: 'Exporter la page', total: (n: string) => `${n} projets`, pageOf: (p: number, total: number) => `Page ${p} sur ${total}`, colName: 'Projet', colStatus: 'Statut', colCategory: 'Catégorie', colGoal: 'Objectif', colPledged: 'Collecté', colFunded: 'Financé', colBackers: 'Contributeurs', colDays: 'Jours', colCountry: 'Pays', colLaunch: 'Lancement', periods: { all: 'Toutes dates', week: 'Semaine dernière', month: 'Mois dernier', year: 'Année dernière', custom: 'Personnalisé' }, sorts: { usd_pledged: 'Montant collecté', backers: 'Contributeurs', funding_rate: 'Taux de financement', launched: 'Plus récent' }, states: { all: 'Tous', live: 'En cours', prelaunch: 'Pré-lancement', successful: 'Réussi', failed: 'Échoué', canceled: 'Annulé', suspended: 'Suspendu' }, allCategories: 'Toutes catégories', allCountries: 'Tous pays', staffPick: 'Staff Pick' },
    auth: { signIn: 'Connexion', createAccount: 'Créer un compte', emailPlaceholder: 'E-mail', passwordPlaceholder: 'Mot de passe (6 caractères min.)', headerDesc: 'Connectez-vous pour accéder à toutes les données', noAccount: 'Pas encore de compte ?', hasAccount: 'Déjà un compte ?', errorGeneric: 'Une erreur est survenue. Réessayez.', logout: 'Déconnexion', loginToUse: 'Connectez-vous pour utiliser cette fonction', loginRequired: 'Connexion requise', loginToFilter: 'Filtres, tri et pages supplémentaires nécessitent une connexion', loginToAnalyze: 'La prédiction AI nécessite une connexion', loginToFavorite: 'Connectez-vous pour enregistrer', unlockSection: 'Connectez-vous pour tout voir', unlockHint: 'Connexion requise pour données complètes, filtres et classements.' },
    favorites: { title: 'Favoris', subtitle: 'Vos projets enregistrés', empty: 'Aucun favori pour le moment', emptyHint: 'Cliquez sur ♥ sur un projet pour l’enregistrer ici', remove: 'Retirer' },
    landing: { tagline: 'Les données Kickstarter, décodées', subtitle: 'Découvrez des tendances et opportunités dans plus de 200 000 campagnes Kickstarter', cta: 'Aller au tableau de bord', learnMore: 'En savoir plus', stats: { projects: 'Campagnes', rate: 'Taux de réussite', raised: 'Total collecté', categories: 'Catégories' }, feature1Title: 'Explorer les projets', feature1Desc: 'Recherchez et filtrez par mot-clé, statut, catégorie et pays.', feature2Title: 'Analyse approfondie', feature2Desc: 'Analysez catégories, tendances mensuelles et pays.', feature3Title: 'Prédiction AI', feature3Desc: 'Collez une URL Kickstarter de pré-lancement et obtenez un score AI.', loginStatus: 'Connecté en tant que', nav: { dashboard: 'Tableau de bord', about: 'À propos' } },
    analysis: { title: 'Analyse', subtitle: 'Analysez les données Kickstarter par catégorie, tendance et pays', tabCategories: 'Catégories', tabTrends: 'Tendances', tabCountries: 'Pays', period: 'Période', allTime: 'Tout', customRange: 'Personnalisé', from: 'De', to: 'À' },
    predict: { title: 'Prédiction de campagne', subtitle: 'Collez une page Kickstarter de pré-lancement pour une évaluation AI', analyzeBtn: 'Analyser', analyzing: 'Analyse...', errorInvalid: 'Veuillez saisir une URL Kickstarter valide', resultTitle: 'Résultats', totalScore: 'Score global', prediction: 'Prédiction', highlights: 'Points forts', concerns: 'Risques', tryAnother: 'Analyser à nouveau' },
  },
  es: {
    nav: { subtitle: 'Plataforma de datos Kickstarter', overview: 'Resumen', projects: 'Proyectos', predict: 'Predecir', analysis: 'Análisis', categories: 'Categorías', trends: 'Tendencias', countries: 'Países', sync: 'Sync', about: 'Acerca de', leaderboard: 'Clasificación', awards: 'Sonar Awards', liveIntel: 'Live Intel', favorites: 'Favoritos', dataQuality: 'Calidad de datos', analytics: 'Analytics', users: 'Usuarios', updates: 'Actualizaciones', globalConfig: 'Config global', adminViews: 'Vistas admin' },
    states: { successful: 'Exitoso', failed: 'Fallido', live: 'En vivo', canceled: 'Cancelado', suspended: 'Suspendido', prelaunch: 'Prelanzamiento' },
    projects: { title: 'Proyectos', subtitle: 'Busca y filtra campañas de Kickstarter', period: 'Periodo de lanzamiento', searchLabel: 'Buscar', searchPlaceholder: 'Nombre o descripción...', statusLabel: 'Estado', categoryLabel: 'Categoría', countryLabel: 'País', sortLabel: 'Ordenar', searchBtn: 'Buscar', exportSelected: (n: number) => `Exportar (${n})`, exportPage: 'Exportar página', total: (n: string) => `${n} proyectos`, pageOf: (p: number, total: number) => `Página ${p} de ${total}`, colName: 'Proyecto', colStatus: 'Estado', colCategory: 'Categoría', colGoal: 'Meta', colPledged: 'Recaudado', colFunded: 'Financiado', colBackers: 'Patrocinadores', colDays: 'Días', colCountry: 'País', colLaunch: 'Lanzamiento', periods: { all: 'Todo el tiempo', week: 'Última semana', month: 'Último mes', year: 'Último año', custom: 'Personalizado' }, sorts: { usd_pledged: 'Monto recaudado', backers: 'Patrocinadores', funding_rate: 'Tasa de financiación', launched: 'Más recientes' }, states: { all: 'Todos', live: 'En vivo', prelaunch: 'Prelanzamiento', successful: 'Exitoso', failed: 'Fallido', canceled: 'Cancelado', suspended: 'Suspendido' }, allCategories: 'Todas las categorías', allCountries: 'Todos los países', staffPick: 'Staff Pick' },
    auth: { signIn: 'Iniciar sesión', createAccount: 'Crear cuenta', emailPlaceholder: 'Correo', passwordPlaceholder: 'Contraseña (mín. 6 caracteres)', headerDesc: 'Inicia sesión para acceder a todos los datos', noAccount: '¿No tienes cuenta?', hasAccount: '¿Ya tienes cuenta?', errorGeneric: 'Algo salió mal. Inténtalo de nuevo.', logout: 'Cerrar sesión', loginToUse: 'Inicia sesión para usar esta función', loginRequired: 'Inicio de sesión requerido', loginToFilter: 'Filtros, orden y más páginas requieren sesión', loginToAnalyze: 'La predicción AI requiere sesión', loginToFavorite: 'Inicia sesión para guardar', unlockSection: 'Inicia sesión para ver todo', unlockHint: 'Inicia sesión para datos completos, filtros y clasificaciones.' },
    favorites: { title: 'Favoritos', subtitle: 'Tus proyectos guardados', empty: 'Aún no hay favoritos', emptyHint: 'Haz clic en ♥ en cualquier proyecto para guardarlo aquí', remove: 'Quitar' },
    landing: { tagline: 'Datos de Kickstarter, descifrados', subtitle: 'Descubre patrones y oportunidades en más de 200.000 campañas de Kickstarter', cta: 'Ir al panel', learnMore: 'Más información', stats: { projects: 'Campañas', rate: 'Tasa de éxito', raised: 'Total recaudado', categories: 'Categorías' }, feature1Title: 'Explorador de proyectos', feature1Desc: 'Busca y filtra por palabra clave, estado, categoría y país.', feature2Title: 'Análisis profundo', feature2Desc: 'Analiza categorías, tendencias mensuales y países.', feature3Title: 'Predicción AI', feature3Desc: 'Pega una URL de prelanzamiento de Kickstarter y obtén un score AI.', loginStatus: 'Sesión iniciada como', nav: { dashboard: 'Panel', about: 'Acerca de' } },
    analysis: { title: 'Análisis', subtitle: 'Analiza datos de Kickstarter por categoría, tendencia y país', tabCategories: 'Categorías', tabTrends: 'Tendencias', tabCountries: 'Países', period: 'Rango', allTime: 'Todo', customRange: 'Personalizado', from: 'Desde', to: 'Hasta' },
    predict: { title: 'Predicción de campaña', subtitle: 'Pega una página de prelanzamiento de Kickstarter para una evaluación AI', analyzeBtn: 'Analizar', analyzing: 'Analizando...', errorInvalid: 'Introduce una URL válida de Kickstarter', resultTitle: 'Resultados', totalScore: 'Puntuación total', prediction: 'Predicción', highlights: 'Fortalezas', concerns: 'Riesgos', tryAnother: 'Analizar otra vez' },
  },
};

export const t: Record<Lang, LocaleTree> = {
  en: baseT.en,
  cn: baseT.cn as unknown as LocaleTree,
  'zh-tw': mergeLocale(baseT.cn as unknown as LocaleTree, localeOverrides['zh-tw']),
  ja: mergeLocale(baseT.en, localeOverrides.ja),
  ko: mergeLocale(baseT.en, localeOverrides.ko),
  de: mergeLocale(baseT.en, localeOverrides.de),
  it: mergeLocale(baseT.en, localeOverrides.it),
  fr: mergeLocale(baseT.en, localeOverrides.fr),
  es: mergeLocale(baseT.en, localeOverrides.es),
};

export type Translations = typeof t;

type UiCopy = {
  common: {
    language: string;
    loading: string;
    search: string;
    reset: string;
    unknown: string;
    ended: string;
    daysLeft: (n: number) => string;
    hoursLeft: (n: number) => string;
  };
  globalSearch: {
    placeholder: string;
    seeAll: (q: string) => string;
    keepTyping: string;
    noMatches: string;
    trending: string;
  };
  login: {
    verifyEmail: string;
    codeSent: (email: string) => string;
    otpPlaceholder: string;
    verifyAndSignIn: string;
    back: string;
    passwordRule: string;
    otpNotice: string;
  };
  announcements: {
    recentUpdates: string;
    featureUpdate: string;
    maybeLater: string;
    explore: string;
  };
  push: {
    favoritesNote: string;
    favoritesTitle: string;
    platformNote: string;
    platformTitle: string;
    onboardingNote: string;
    onboardingTitle: string;
    pledgedToday: string;
    newBackers: string;
    liveFavorites: (n: number) => string;
    live: string;
    launched: string;
    funded: string;
    pledged24h: string;
    backers24h: string;
    ending: string;
    daysLeftShort: (n: number) => string;
    sections: Record<'fastestFunding' | 'fastestBackers' | 'newlyLaunched' | 'endingSoon', string>;
    maybeLater: string;
    explore: string;
  };
  landing: {
    searchCampaigns: string;
    filter: string;
    project: string;
    category: string;
    pledged: string;
    funded: string;
    monthlyTrend: string;
    launchesRate: string;
    total: string;
    rate: string;
    peak: string;
    brand: string;
    concept: string;
    market: string;
    prelaunch: string;
    risk: string;
    aiScore: string;
    overallScore: string;
    likelySuccess: string;
    searchProjects: string;
    searchFor: (q: string) => string;
    liveBadge: string;
    foundersSay: string;
    foundersSub: string;
    faq: string;
    start: string;
    startSub: string;
    createFree: string;
    exploreData: string;
    stateLabels: Record<string, string>;
  };
  favorites: {
    browse: string;
    projectName: string;
    status: string;
    category: string;
    pledged: string;
    backers: string;
    actions: string;
    expand: string;
    collapse: string;
    subcategory: string;
    country: string;
    goal: string;
    funded: string;
    deadline: string;
    projectId: string;
  };
  projects: {
    endedAt: (date: string) => string;
    daysLeft: (n: number) => string;
    hoursLeft: (n: number) => string;
    subcategory: string;
    allSubcategories: string;
    agency: string;
    allAgencies: string;
    hasAgency: string;
    editView: string;
    visibleColumns: string;
    selected: (n: number) => string;
    detectedAgency: string;
    live: string;
    closing: string;
  };
  analysis: {
    overview: string;
    timeAnalysis: string;
    monthNames: string[];
    pledged: string;
    projects: string;
    successRate: string;
    backers: string;
    fullYear: string;
    byMonth: string;
    month: string;
    yearA: string;
    yearB: string;
    granularity: string;
    dimension: string;
    categoryOptional: string;
    allCategories: string;
    countryOptional: string;
    allCountries: string;
    comparisonTitle: (dimension: string, scope: string) => string;
    monthlyComparison: (dimension: string, a: number, b: number) => string;
  };
  predict: {
    dimensions: Record<'brand' | 'concept' | 'market' | 'prelaunch' | 'risk', string>;
    api: {
      invalidUrl: string;
      fetching: string;
      fetched: string;
      analyzing: string;
      complete: string;
      promptInstruction: string;
    };
  };
};

const enUi: UiCopy = {
  common: { language: 'Language', loading: 'Loading...', search: 'Search', reset: 'Reset', unknown: 'unknown', ended: 'Ended', daysLeft: n => `${n}d left`, hoursLeft: n => `${n}h left` },
  globalSearch: { placeholder: 'Search campaigns...', seeAll: q => `See all results for "${q}" →`, keepTyping: 'Keep typing to search...', noMatches: 'No matching campaigns', trending: 'Trending' },
  login: { verifyEmail: 'Verify your email', codeSent: email => `We sent a 6-digit code to ${email}`, otpPlaceholder: 'Enter 6-digit code', verifyAndSignIn: 'Verify & Sign In', back: '← Back', passwordRule: 'Password must be at least 8 characters and include both letters and numbers.', otpNotice: "We'll send a verification code to your email" },
  announcements: { recentUpdates: 'What is new in Kicksonar', featureUpdate: 'Feature update', maybeLater: 'Maybe later', explore: 'Explore' },
  push: { favoritesNote: 'My favorites · Daily digest', favoritesTitle: 'Your tracked projects moved', platformNote: 'Platform pulse · Daily', platformTitle: 'Today on Kickstarter', onboardingNote: 'Welcome to Kicksonar', onboardingTitle: 'Get started in a minute', pledgedToday: 'Pledged today', newBackers: 'New backers', liveFavorites: n => `${n} live favorites`, live: 'Live', launched: 'Launched', funded: 'Funded', pledged24h: '24h pledged', backers24h: '24h backers', ending: 'Ending', daysLeftShort: n => `${n}d left`, sections: { fastestFunding: 'Top movers', fastestBackers: 'Most backers gained', newlyLaunched: 'Newly launched', endingSoon: 'Ending soon' }, maybeLater: 'Maybe later', explore: 'Explore' },
  landing: { searchCampaigns: 'Search campaigns...', filter: 'Filter', project: 'Project', category: 'Category', pledged: 'Pledged', funded: 'Funded', monthlyTrend: 'Monthly Trend Analysis', launchesRate: 'Monthly Launches & Success Rate', total: 'Total', rate: 'Rate', peak: 'Peak', brand: 'Brand', concept: 'Concept', market: 'Market', prelaunch: 'Pre-launch', risk: 'Risk', aiScore: 'AI Prediction Score', overallScore: 'Overall Score / 100', likelySuccess: '✓ Likely to Succeed', searchProjects: 'Search campaigns...', searchFor: q => `Search for "${q}" →`, liveBadge: 'Live Data · 200K+ Campaigns', foundersSay: 'What founders say', foundersSub: 'From founders and consultants who use Kicksonar', faq: 'Frequently asked questions', start: 'Start for free', startSub: 'Free to register. Full data access. No credit card.', createFree: 'Create Free Account', exploreData: 'Explore Data', stateLabels: { live: 'Live', successful: 'Successful', failed: 'Failed', canceled: 'Offline', suspended: 'Offline' } },
  favorites: { browse: 'Browse Projects', projectName: 'Project', status: 'Status', category: 'Category', pledged: 'Pledged', backers: 'Backers', actions: 'Actions', expand: 'Expand', collapse: 'Collapse', subcategory: 'Subcategory', country: 'Country', goal: 'Goal', funded: 'Funded', deadline: 'Deadline', projectId: 'Project ID' },
  projects: { endedAt: date => `Ended · ${date}`, daysLeft: n => `${n}d left`, hoursLeft: n => `${n}h left`, subcategory: 'Subcategory', allSubcategories: 'All subcategories', agency: 'Agency', allAgencies: 'All agencies', hasAgency: 'Has agency', editView: 'Edit View', visibleColumns: 'Visible columns', selected: n => `${n} selected`, detectedAgency: 'Agency detected', live: 'live', closing: 'Closing' },
  analysis: { overview: 'Overview', timeAnalysis: 'Time Analysis', monthNames: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], pledged: 'Pledged', projects: 'Projects', successRate: 'Success rate', backers: 'Backers', fullYear: 'Full year', byMonth: 'By month', month: 'Month', yearA: 'Year A', yearB: 'Year B', granularity: 'Granularity', dimension: 'Dimension', categoryOptional: 'Category (optional)', allCategories: 'All categories', countryOptional: 'Country (optional)', allCountries: 'All countries', comparisonTitle: (d, s) => `${d} · ${s}`, monthlyComparison: (d, a, b) => `Monthly ${d} (${a} vs ${b})` },
  predict: { dimensions: { brand: 'Brand Credibility', concept: 'Concept Clarity', market: 'Market Fit', prelaunch: 'Pre-launch Quality', risk: 'Risk Assessment' }, api: { invalidUrl: 'Please enter a valid Kickstarter URL', fetching: 'Fetching page content...', fetched: 'Page content retrieved', analyzing: 'AI deep analysis in progress...', complete: 'Analysis complete', promptInstruction: 'Write all free-text fields in English.' } },
};

export const uiCopy: Record<Lang, UiCopy> = {
  en: enUi,
  cn: mergeLocale(enUi, {
    common: { language: '语言', loading: '加载中...', search: '搜索', reset: '重置', unknown: '未知', ended: '已结束', daysLeft: n => `还有 ${n} 天`, hoursLeft: n => `还有 ${n} 小时` },
    globalSearch: { placeholder: '搜索项目名称...', seeAll: q => `查看 "${q}" 的全部结果 →`, keepTyping: '继续输入以搜索...', noMatches: '没有匹配的项目', trending: '热门项目' },
    login: { verifyEmail: '验证你的邮箱', codeSent: email => `验证码已发送到 ${email}`, otpPlaceholder: '输入 6 位验证码', verifyAndSignIn: '验证并登录', back: '← 返回修改邮箱', passwordRule: '密码至少 8 位，需同时包含字母和数字。', otpNotice: '注册后我们会发送验证码到你的邮箱' },
    announcements: { recentUpdates: 'Kicksonar 最近更新', featureUpdate: '新功能更新', maybeLater: '稍后再看', explore: '去看看' },
    push: { favoritesNote: '我的收藏 · 今日动态', favoritesTitle: '收藏项目有新进展', platformNote: '平台速览 · 每日一览', platformTitle: '今天的 Kickstarter 动态', onboardingNote: '欢迎使用 Kicksonar', onboardingTitle: '一分钟上手核心功能', pledgedToday: '今日合计筹款', newBackers: '今日新增支持者', liveFavorites: n => `${n} 个进行中收藏`, live: '进行中', launched: '今日新上线', funded: '已达标', pledged24h: '24h 筹款', backers24h: '24h 支持者', ending: '24h 内结束', daysLeftShort: n => `剩 ${n} 天`, sections: { fastestFunding: '昨日增长最快', fastestBackers: '支持者增长最快', newlyLaunched: '新上线项目', endingSoon: '即将结束' }, maybeLater: '稍后再看', explore: '去看看' },
    landing: { searchCampaigns: '搜索项目...', filter: '筛选', project: '项目', category: '类目', pledged: '金额', funded: '完成率', monthlyTrend: '月度趋势分析', launchesRate: '月度发起量 & 成功率', total: '总项目', rate: '成功率', peak: '峰值月', brand: '品牌', concept: '概念', market: '市场', prelaunch: '预热', risk: '风险', aiScore: 'AI 预测评分', overallScore: '综合评分 / 100', likelySuccess: '✓ 较可能成功', searchProjects: '搜索项目名称...', searchFor: q => `搜索 "${q}" →`, liveBadge: '实时数据 · 200K+ 众筹项目', foundersSay: '用数据说话', foundersSub: '来自使用 Kicksonar 的创业者和顾问', faq: '常见问题', start: '现在就开始', startSub: '免费注册，解锁全部数据和分析功能，无需信用卡', createFree: '免费注册', exploreData: '先逛逛数据', stateLabels: { live: '进行中', successful: '成功', failed: '失败', canceled: '已下线', suspended: '已下线' } },
    favorites: { browse: '浏览项目', projectName: '项目名称', status: '状态', category: '类目', pledged: '众筹金额', backers: '支持人数', actions: '操作', expand: '展开详情', collapse: '收起详情', subcategory: '二级类目', country: '国家', goal: '目标', funded: '完成率', deadline: '截止时间', projectId: '项目 ID' },
    projects: { endedAt: date => `已结束 · ${date}`, daysLeft: n => `还有 ${n} 天`, hoursLeft: n => `还有 ${n} 小时`, subcategory: '二级类目', allSubcategories: '全部二级类目', agency: '服务商', allAgencies: '全部服务商', hasAgency: '有服务商', editView: '编辑视图', visibleColumns: '列表字段', selected: n => `已选 ${n} 项`, detectedAgency: '已识别服务商', live: '实时', closing: '下线时间' },
    analysis: { overview: '数据概览', timeAnalysis: '时间分析', monthNames: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'], pledged: '融资额', projects: '项目数', successRate: '成功率', backers: '支持者', fullYear: '全年', byMonth: '指定月份', month: '月份', yearA: '对比年份 A', yearB: '对比年份 B', granularity: '对比粒度', dimension: '对比维度', categoryOptional: '类目（可选）', allCategories: '全部类目', countryOptional: '国家（可选）', allCountries: '全部国家', comparisonTitle: (d, s) => `${d} · ${s}对比`, monthlyComparison: (d, a, b) => `逐月${d}对比（${a} vs ${b}）` },
    predict: { dimensions: { brand: '品牌背景', concept: '产品清晰度', market: '市场契合度', prelaunch: '预热质量', risk: '风险评估' }, api: { invalidUrl: '请输入有效的 Kickstarter 链接', fetching: '正在获取页面内容...', fetched: '页面内容获取完成', analyzing: 'AI 正在深度分析中...', complete: '分析完成', promptInstruction: 'Write all free-text fields in Simplified Chinese.' } },
  }),
  'zh-tw': mergeLocale(enUi, {
    common: { language: '語言', loading: '載入中...', search: '搜尋', reset: '重置', unknown: '未知', ended: '已結束', daysLeft: n => `還有 ${n} 天`, hoursLeft: n => `還有 ${n} 小時` },
    globalSearch: { placeholder: '搜尋項目名稱...', seeAll: q => `查看「${q}」的全部結果 →`, keepTyping: '繼續輸入以搜尋...', noMatches: '沒有匹配的項目', trending: '熱門項目' },
    login: { verifyEmail: '驗證你的電子郵件', codeSent: email => `驗證碼已發送到 ${email}`, otpPlaceholder: '輸入 6 位驗證碼', verifyAndSignIn: '驗證並登入', back: '← 返回修改電子郵件', passwordRule: '密碼至少 8 位，且需包含字母和數字。', otpNotice: '註冊後我們會寄送驗證碼到你的電子郵件' },
    announcements: { recentUpdates: 'Kicksonar 最近更新', featureUpdate: '新功能更新', maybeLater: '稍後再看', explore: '去看看' },
    push: { favoritesNote: '我的收藏 · 今日動態', favoritesTitle: '收藏項目有新進展', platformNote: '平台速覽 · 每日一覽', platformTitle: '今天的 Kickstarter 動態', onboardingNote: '歡迎使用 Kicksonar', onboardingTitle: '一分鐘上手核心功能', pledgedToday: '今日合計籌款', newBackers: '今日新增支持者', liveFavorites: n => `${n} 個進行中收藏`, live: '進行中', launched: '今日新上線', funded: '已達標', pledged24h: '24h 籌款', backers24h: '24h 支持者', ending: '24h 內結束', daysLeftShort: n => `剩 ${n} 天`, sections: { fastestFunding: '昨日增長最快', fastestBackers: '支持者增長最快', newlyLaunched: '新上線項目', endingSoon: '即將結束' }, maybeLater: '稍後再看', explore: '去看看' },
    landing: { ...enUi.landing, searchCampaigns: '搜尋項目...', filter: '篩選', project: '項目', category: '類目', pledged: '金額', funded: '完成率', searchProjects: '搜尋項目名稱...', liveBadge: '即時數據 · 200K+ 眾籌項目', foundersSay: '用數據說話', faq: '常見問題', start: '現在就開始', createFree: '免費註冊', exploreData: '先逛逛數據', stateLabels: { live: '進行中', successful: '成功', failed: '失敗', canceled: '已下線', suspended: '已下線' } },
    favorites: { browse: '瀏覽項目', projectName: '項目名稱', status: '狀態', category: '類目', pledged: '眾籌金額', backers: '支持人數', actions: '操作', expand: '展開詳情', collapse: '收起詳情', subcategory: '二級類目', country: '國家', goal: '目標', funded: '完成率', deadline: '截止時間', projectId: '項目 ID' },
    projects: { endedAt: date => `已結束 · ${date}`, daysLeft: n => `還有 ${n} 天`, hoursLeft: n => `還有 ${n} 小時`, subcategory: '二級類目', allSubcategories: '全部二級類目', agency: '服務商', allAgencies: '全部服務商', hasAgency: '有服務商', editView: '編輯視圖', visibleColumns: '列表欄位', selected: n => `已選 ${n} 項`, detectedAgency: '已識別服務商', live: '即時', closing: '下線時間' },
    analysis: { ...enUi.analysis, overview: '數據概覽', timeAnalysis: '時間分析', monthNames: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'], pledged: '融資額', projects: '項目數', successRate: '成功率', backers: '支持者', fullYear: '全年', byMonth: '指定月份', month: '月份', yearA: '對比年份 A', yearB: '對比年份 B', granularity: '對比粒度', dimension: '對比維度', categoryOptional: '類目（可選）', allCategories: '全部類目', countryOptional: '國家（可選）', allCountries: '全部國家', comparisonTitle: (d, s) => `${d} · ${s}對比`, monthlyComparison: (d, a, b) => `逐月${d}對比（${a} vs ${b}）` },
    predict: { dimensions: { brand: '品牌背景', concept: '產品清晰度', market: '市場契合度', prelaunch: '預熱品質', risk: '風險評估' }, api: { invalidUrl: '請輸入有效的 Kickstarter 連結', fetching: '正在取得頁面內容...', fetched: '頁面內容取得完成', analyzing: 'AI 正在深度分析中...', complete: '分析完成', promptInstruction: 'Write all free-text fields in Traditional Chinese.' } },
  }),
  ja: mergeLocale(enUi, {
    common: { language: '言語', loading: '読み込み中...', search: '検索', reset: 'リセット', unknown: '不明', ended: '終了', daysLeft: n => `残り${n}日`, hoursLeft: n => `残り${n}時間` },
    globalSearch: { placeholder: 'キャンペーンを検索...', seeAll: q => `"${q}" のすべての結果を見る →`, keepTyping: '入力を続けて検索...', noMatches: '一致するキャンペーンがありません', trending: 'トレンド' },
    login: { verifyEmail: 'メールを確認', codeSent: email => `6桁のコードを ${email} に送信しました`, otpPlaceholder: '6桁コードを入力', verifyAndSignIn: '確認してログイン', back: '← 戻る', passwordRule: 'パスワードは8文字以上で、英字と数字を含めてください。', otpNotice: '確認コードをメールで送信します' },
    announcements: { recentUpdates: 'Kicksonar の最新情報', featureUpdate: '機能アップデート', maybeLater: 'あとで見る', explore: '見る' },
    push: { favoritesNote: 'お気に入り · デイリー', favoritesTitle: '保存したプロジェクトに動きがあります', platformNote: 'プラットフォーム動向 · 毎日', platformTitle: '今日の Kickstarter', onboardingNote: 'Kicksonar へようこそ', onboardingTitle: '1分で始めましょう', pledgedToday: '本日の調達額', newBackers: '新規支援者', liveFavorites: n => `${n} 件の進行中お気に入り`, live: '進行中', launched: '開始', funded: '達成', pledged24h: '24h 調達', backers24h: '24h 支援者', ending: '終了間近', daysLeftShort: n => `残り${n}日`, sections: { fastestFunding: '伸び率トップ', fastestBackers: '支援者増トップ', newlyLaunched: '新規開始', endingSoon: 'まもなく終了' }, maybeLater: 'あとで見る', explore: '見る' },
    landing: { searchCampaigns: 'キャンペーンを検索...', filter: 'フィルタ', project: 'プロジェクト', category: 'カテゴリ', pledged: '調達額', funded: '達成率', monthlyTrend: '月次トレンド分析', launchesRate: '月次開始数と成功率', total: '合計', rate: '率', peak: 'ピーク', brand: 'ブランド', concept: 'コンセプト', market: '市場', prelaunch: 'プレローンチ', risk: 'リスク', aiScore: 'AI 予測スコア', overallScore: '総合スコア / 100', likelySuccess: '成功可能性あり', searchProjects: 'キャンペーンを検索...', searchFor: q => `"${q}" を検索 →`, liveBadge: 'リアルタイムデータ · 200K+ キャンペーン', foundersSay: '利用者の声', foundersSub: 'Kicksonar を使う創業者とコンサルタントより', faq: 'よくある質問', start: '無料で始める', startSub: '登録無料。全データにアクセス。カード不要。', createFree: '無料アカウント作成', exploreData: 'データを見る', stateLabels: { live: '進行中', successful: '成功', failed: '失敗', canceled: 'オフライン', suspended: 'オフライン' } },
    favorites: { browse: 'プロジェクトを見る', projectName: 'プロジェクト', status: '状態', category: 'カテゴリ', pledged: '調達額', backers: '支援者', actions: '操作', expand: '展開', collapse: '閉じる', subcategory: 'サブカテゴリ', country: '国', goal: '目標', funded: '達成率', deadline: '締切', projectId: 'プロジェクト ID' },
    projects: { endedAt: date => `終了 · ${date}`, daysLeft: n => `残り${n}日`, hoursLeft: n => `残り${n}時間`, subcategory: 'サブカテゴリ', allSubcategories: 'すべてのサブカテゴリ', agency: '支援会社', allAgencies: 'すべての支援会社', hasAgency: '支援会社あり', editView: '表示を編集', visibleColumns: '表示列', selected: n => `${n} 件選択`, detectedAgency: '支援会社検出', live: '進行中', closing: '終了日時' },
    analysis: { overview: '概要', timeAnalysis: '時間分析', monthNames: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'], pledged: '調達額', projects: 'プロジェクト', successRate: '成功率', backers: '支援者', fullYear: '通年', byMonth: '月別', month: '月', yearA: '比較年 A', yearB: '比較年 B', granularity: '粒度', dimension: 'ディメンション', categoryOptional: 'カテゴリ（任意）', allCategories: 'すべてのカテゴリ', countryOptional: '国（任意）', allCountries: 'すべての国', comparisonTitle: (d, s) => `${d} · ${s}`, monthlyComparison: (d, a, b) => `${d} 月次比較（${a} vs ${b}）` },
    predict: { dimensions: { brand: 'ブランド信頼性', concept: 'コンセプト明確度', market: '市場適合性', prelaunch: 'プレローンチ品質', risk: 'リスク評価' }, api: { invalidUrl: '有効な Kickstarter URL を入力してください', fetching: 'ページ内容を取得中...', fetched: 'ページ内容を取得しました', analyzing: 'AI が詳細分析中...', complete: '分析完了', promptInstruction: 'Write all free-text fields in Japanese.' } },
  }),
  ko: mergeLocale(enUi, {
    common: { language: '언어', loading: '로딩 중...', search: '검색', reset: '초기화', unknown: '알 수 없음', ended: '종료됨', daysLeft: n => `${n}일 남음`, hoursLeft: n => `${n}시간 남음` },
    globalSearch: { placeholder: '캠페인 검색...', seeAll: q => `"${q}" 전체 결과 보기 →`, keepTyping: '계속 입력하여 검색...', noMatches: '일치하는 캠페인이 없습니다', trending: '인기 프로젝트' },
    login: { verifyEmail: '이메일 확인', codeSent: email => `6자리 코드를 ${email}(으)로 보냈습니다`, otpPlaceholder: '6자리 코드 입력', verifyAndSignIn: '확인 후 로그인', back: '← 뒤로', passwordRule: '비밀번호는 8자 이상이며 문자와 숫자를 포함해야 합니다.', otpNotice: '이메일로 확인 코드를 보내드립니다' },
    announcements: { recentUpdates: 'Kicksonar 최근 업데이트', featureUpdate: '기능 업데이트', maybeLater: '나중에 보기', explore: '보기' },
    push: { favoritesNote: '내 즐겨찾기 · 일일 요약', favoritesTitle: '저장한 프로젝트에 변화가 있습니다', platformNote: '플랫폼 동향 · 매일', platformTitle: '오늘의 Kickstarter', onboardingNote: 'Kicksonar에 오신 것을 환영합니다', onboardingTitle: '1분 안에 시작하기', pledgedToday: '오늘 모금액', newBackers: '신규 후원자', liveFavorites: n => `진행 중 즐겨찾기 ${n}개`, live: '진행 중', launched: '출시', funded: '달성', pledged24h: '24h 모금', backers24h: '24h 후원자', ending: '마감 임박', daysLeftShort: n => `${n}일 남음`, sections: { fastestFunding: '모금 상승 Top', fastestBackers: '후원자 증가 Top', newlyLaunched: '신규 출시', endingSoon: '곧 마감' }, maybeLater: '나중에 보기', explore: '보기' },
    landing: { searchCampaigns: '캠페인 검색...', filter: '필터', project: '프로젝트', category: '카테고리', pledged: '모금액', funded: '달성률', monthlyTrend: '월별 트렌드 분석', launchesRate: '월별 출시 및 성공률', total: '합계', rate: '비율', peak: '피크', brand: '브랜드', concept: '콘셉트', market: '시장', prelaunch: '프리런치', risk: '리스크', aiScore: 'AI 예측 점수', overallScore: '종합 점수 / 100', likelySuccess: '성공 가능성 높음', searchProjects: '캠페인 검색...', searchFor: q => `"${q}" 검색 →`, liveBadge: '실시간 데이터 · 200K+ 캠페인', foundersSay: '사용자 후기', foundersSub: 'Kicksonar를 쓰는 창업자와 컨설턴트', faq: '자주 묻는 질문', start: '무료로 시작', startSub: '무료 가입. 전체 데이터 접근. 카드 불필요.', createFree: '무료 계정 만들기', exploreData: '데이터 둘러보기', stateLabels: { live: '진행 중', successful: '성공', failed: '실패', canceled: '오프라인', suspended: '오프라인' } },
    favorites: { browse: '프로젝트 보기', projectName: '프로젝트', status: '상태', category: '카테고리', pledged: '모금액', backers: '후원자', actions: '작업', expand: '펼치기', collapse: '접기', subcategory: '하위 카테고리', country: '국가', goal: '목표', funded: '달성률', deadline: '마감일', projectId: '프로젝트 ID' },
    projects: { endedAt: date => `종료 · ${date}`, daysLeft: n => `${n}일 남음`, hoursLeft: n => `${n}시간 남음`, subcategory: '하위 카테고리', allSubcategories: '모든 하위 카테고리', agency: '대행사', allAgencies: '모든 대행사', hasAgency: '대행사 있음', editView: '보기 편집', visibleColumns: '표시 열', selected: n => `${n}개 선택됨`, detectedAgency: '대행사 감지됨', live: '진행 중', closing: '마감' },
    analysis: { overview: '개요', timeAnalysis: '시간 분석', monthNames: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'], pledged: '모금액', projects: '프로젝트', successRate: '성공률', backers: '후원자', fullYear: '전체 연도', byMonth: '월별', month: '월', yearA: '비교 연도 A', yearB: '비교 연도 B', granularity: '단위', dimension: '차원', categoryOptional: '카테고리(선택)', allCategories: '모든 카테고리', countryOptional: '국가(선택)', allCountries: '모든 국가', comparisonTitle: (d, s) => `${d} · ${s}`, monthlyComparison: (d, a, b) => `${d} 월별 비교(${a} vs ${b})` },
    predict: { dimensions: { brand: '브랜드 신뢰도', concept: '콘셉트 명확성', market: '시장 적합성', prelaunch: '프리런치 품질', risk: '리스크 평가' }, api: { invalidUrl: '유효한 Kickstarter URL을 입력하세요', fetching: '페이지 콘텐츠 가져오는 중...', fetched: '페이지 콘텐츠를 가져왔습니다', analyzing: 'AI 심층 분석 중...', complete: '분석 완료', promptInstruction: 'Write all free-text fields in Korean.' } },
  }),
  de: mergeLocale(enUi, {
    common: { language: 'Sprache', loading: 'Lädt...', search: 'Suchen', reset: 'Zurücksetzen', unknown: 'unbekannt', ended: 'Beendet', daysLeft: n => `${n} Tage übrig`, hoursLeft: n => `${n} Std. übrig` },
    globalSearch: { placeholder: 'Kampagnen suchen...', seeAll: q => `Alle Ergebnisse für "${q}" anzeigen →`, keepTyping: 'Weiter tippen zum Suchen...', noMatches: 'Keine passenden Kampagnen', trending: 'Trending' },
    login: { verifyEmail: 'E-Mail bestätigen', codeSent: email => `Wir haben einen 6-stelligen Code an ${email} gesendet`, otpPlaceholder: '6-stelligen Code eingeben', verifyAndSignIn: 'Bestätigen & anmelden', back: '← Zurück', passwordRule: 'Das Passwort muss mindestens 8 Zeichen haben und Buchstaben sowie Zahlen enthalten.', otpNotice: 'Wir senden einen Bestätigungscode an deine E-Mail' },
    announcements: { recentUpdates: 'Neu bei Kicksonar', featureUpdate: 'Funktionsupdate', maybeLater: 'Später ansehen', explore: 'Ansehen' },
    push: { favoritesNote: 'Favoriten · Tagesübersicht', favoritesTitle: 'Deine gespeicherten Projekte haben sich bewegt', platformNote: 'Plattform-Puls · täglich', platformTitle: 'Heute auf Kickstarter', onboardingNote: 'Willkommen bei Kicksonar', onboardingTitle: 'In einer Minute loslegen', pledgedToday: 'Heute finanziert', newBackers: 'Neue Unterstützer', liveFavorites: n => `${n} Live-Favoriten`, live: 'Live', launched: 'Gestartet', funded: 'Finanziert', pledged24h: '24h Finanzierung', backers24h: '24h Unterstützer', ending: 'Endet bald', daysLeftShort: n => `${n} Tage übrig`, sections: { fastestFunding: 'Top-Bewegungen', fastestBackers: 'Meiste neue Unterstützer', newlyLaunched: 'Neu gestartet', endingSoon: 'Endet bald' }, maybeLater: 'Später ansehen', explore: 'Ansehen' },
    landing: { searchCampaigns: 'Kampagnen suchen...', filter: 'Filter', project: 'Projekt', category: 'Kategorie', pledged: 'Finanziert', funded: 'Quote', monthlyTrend: 'Monatliche Trendanalyse', launchesRate: 'Monatliche Starts & Erfolgsrate', total: 'Gesamt', rate: 'Rate', peak: 'Peak', brand: 'Marke', concept: 'Konzept', market: 'Markt', prelaunch: 'Prelaunch', risk: 'Risiko', aiScore: 'AI Prognose-Score', overallScore: 'Gesamtscore / 100', likelySuccess: 'Wahrscheinlich erfolgreich', searchProjects: 'Kampagnen suchen...', searchFor: q => `Nach "${q}" suchen →`, liveBadge: 'Live-Daten · 200K+ Kampagnen', foundersSay: 'Was Gründer sagen', foundersSub: 'Von Gründern und Beratern, die Kicksonar nutzen', faq: 'Häufige Fragen', start: 'Kostenlos starten', startSub: 'Kostenlose Registrierung. Voller Datenzugang. Keine Kreditkarte.', createFree: 'Kostenloses Konto erstellen', exploreData: 'Daten erkunden', stateLabels: { live: 'Live', successful: 'Erfolgreich', failed: 'Gescheitert', canceled: 'Offline', suspended: 'Offline' } },
    favorites: { browse: 'Projekte ansehen', projectName: 'Projekt', status: 'Status', category: 'Kategorie', pledged: 'Finanziert', backers: 'Unterstützer', actions: 'Aktionen', expand: 'Öffnen', collapse: 'Schließen', subcategory: 'Unterkategorie', country: 'Land', goal: 'Ziel', funded: 'Quote', deadline: 'Deadline', projectId: 'Projekt-ID' },
    projects: { endedAt: date => `Beendet · ${date}`, daysLeft: n => `${n} Tage übrig`, hoursLeft: n => `${n} Std. übrig`, subcategory: 'Unterkategorie', allSubcategories: 'Alle Unterkategorien', agency: 'Agentur', allAgencies: 'Alle Agenturen', hasAgency: 'Mit Agentur', editView: 'Ansicht bearbeiten', visibleColumns: 'Sichtbare Spalten', selected: n => `${n} ausgewählt`, detectedAgency: 'Agentur erkannt', live: 'live', closing: 'Schließt' },
    analysis: { overview: 'Übersicht', timeAnalysis: 'Zeitanalyse', monthNames: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'], pledged: 'Finanziert', projects: 'Projekte', successRate: 'Erfolgsrate', backers: 'Unterstützer', fullYear: 'Ganzes Jahr', byMonth: 'Nach Monat', month: 'Monat', yearA: 'Jahr A', yearB: 'Jahr B', granularity: 'Granularität', dimension: 'Dimension', categoryOptional: 'Kategorie (optional)', allCategories: 'Alle Kategorien', countryOptional: 'Land (optional)', allCountries: 'Alle Länder', comparisonTitle: (d, s) => `${d} · ${s}`, monthlyComparison: (d, a, b) => `Monatlicher Vergleich ${d} (${a} vs ${b})` },
    predict: { dimensions: { brand: 'Markenvertrauen', concept: 'Konzeptklarheit', market: 'Marktpassung', prelaunch: 'Prelaunch-Qualität', risk: 'Risikobewertung' }, api: { invalidUrl: 'Bitte eine gültige Kickstarter-URL eingeben', fetching: 'Seiteninhalt wird geladen...', fetched: 'Seiteninhalt geladen', analyzing: 'AI analysiert...', complete: 'Analyse abgeschlossen', promptInstruction: 'Write all free-text fields in German.' } },
  }),
  it: mergeLocale(enUi, {
    common: { language: 'Lingua', loading: 'Caricamento...', search: 'Cerca', reset: 'Reimposta', unknown: 'sconosciuto', ended: 'Conclusa', daysLeft: n => `${n}g rimasti`, hoursLeft: n => `${n}h rimaste` },
    globalSearch: { placeholder: 'Cerca campagne...', seeAll: q => `Vedi tutti i risultati per "${q}" →`, keepTyping: 'Continua a digitare per cercare...', noMatches: 'Nessuna campagna trovata', trending: 'Di tendenza' },
    login: { verifyEmail: 'Verifica email', codeSent: email => `Abbiamo inviato un codice a 6 cifre a ${email}`, otpPlaceholder: 'Inserisci codice a 6 cifre', verifyAndSignIn: 'Verifica e accedi', back: '← Indietro', passwordRule: 'La password deve avere almeno 8 caratteri e includere lettere e numeri.', otpNotice: 'Invieremo un codice di verifica alla tua email' },
    announcements: { recentUpdates: 'Novità in Kicksonar', featureUpdate: 'Aggiornamento funzione', maybeLater: 'Più tardi', explore: 'Esplora' },
    push: { favoritesNote: 'Preferiti · digest giornaliero', favoritesTitle: 'I tuoi progetti salvati si sono mossi', platformNote: 'Impulso piattaforma · quotidiano', platformTitle: 'Oggi su Kickstarter', onboardingNote: 'Benvenuto in Kicksonar', onboardingTitle: 'Inizia in un minuto', pledgedToday: 'Raccolto oggi', newBackers: 'Nuovi sostenitori', liveFavorites: n => `${n} preferiti live`, live: 'Live', launched: 'Lanciato', funded: 'Finanziato', pledged24h: 'Raccolto 24h', backers24h: 'Sostenitori 24h', ending: 'In chiusura', daysLeftShort: n => `${n}g rimasti`, sections: { fastestFunding: 'Maggiori movimenti', fastestBackers: 'Più sostenitori nuovi', newlyLaunched: 'Nuovi lanci', endingSoon: 'In chiusura' }, maybeLater: 'Più tardi', explore: 'Esplora' },
    landing: { searchCampaigns: 'Cerca campagne...', filter: 'Filtro', project: 'Progetto', category: 'Categoria', pledged: 'Raccolto', funded: 'Finanziato', monthlyTrend: 'Analisi trend mensile', launchesRate: 'Lanci mensili e tasso successo', total: 'Totale', rate: 'Tasso', peak: 'Picco', brand: 'Brand', concept: 'Concept', market: 'Mercato', prelaunch: 'Pre-lancio', risk: 'Rischio', aiScore: 'Score previsione AI', overallScore: 'Score totale / 100', likelySuccess: 'Probabile successo', searchProjects: 'Cerca campagne...', searchFor: q => `Cerca "${q}" →`, liveBadge: 'Dati live · 200K+ campagne', foundersSay: 'Cosa dicono i founder', foundersSub: 'Da founder e consulenti che usano Kicksonar', faq: 'Domande frequenti', start: 'Inizia gratis', startSub: 'Registrazione gratuita. Accesso completo ai dati. Nessuna carta.', createFree: 'Crea account gratis', exploreData: 'Esplora dati', stateLabels: { live: 'Live', successful: 'Riuscito', failed: 'Fallito', canceled: 'Offline', suspended: 'Offline' } },
    favorites: { browse: 'Sfoglia progetti', projectName: 'Progetto', status: 'Stato', category: 'Categoria', pledged: 'Raccolto', backers: 'Sostenitori', actions: 'Azioni', expand: 'Espandi', collapse: 'Comprimi', subcategory: 'Sottocategoria', country: 'Paese', goal: 'Obiettivo', funded: 'Finanziato', deadline: 'Scadenza', projectId: 'ID progetto' },
    projects: { endedAt: date => `Concluso · ${date}`, daysLeft: n => `${n}g rimasti`, hoursLeft: n => `${n}h rimaste`, subcategory: 'Sottocategoria', allSubcategories: 'Tutte le sottocategorie', agency: 'Agenzia', allAgencies: 'Tutte le agenzie', hasAgency: 'Con agenzia', editView: 'Modifica vista', visibleColumns: 'Colonne visibili', selected: n => `${n} selezionati`, detectedAgency: 'Agenzia rilevata', live: 'live', closing: 'Chiusura' },
    analysis: { overview: 'Panoramica', timeAnalysis: 'Analisi temporale', monthNames: ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'], pledged: 'Raccolto', projects: 'Progetti', successRate: 'Tasso successo', backers: 'Sostenitori', fullYear: 'Anno intero', byMonth: 'Per mese', month: 'Mese', yearA: 'Anno A', yearB: 'Anno B', granularity: 'Granularità', dimension: 'Dimensione', categoryOptional: 'Categoria (opzionale)', allCategories: 'Tutte le categorie', countryOptional: 'Paese (opzionale)', allCountries: 'Tutti i paesi', comparisonTitle: (d, s) => `${d} · ${s}`, monthlyComparison: (d, a, b) => `Confronto mensile ${d} (${a} vs ${b})` },
    predict: { dimensions: { brand: 'Credibilità brand', concept: 'Chiarezza concept', market: 'Fit di mercato', prelaunch: 'Qualità pre-lancio', risk: 'Valutazione rischio' }, api: { invalidUrl: 'Inserisci una URL Kickstarter valida', fetching: 'Recupero contenuto pagina...', fetched: 'Contenuto pagina recuperato', analyzing: 'Analisi AI in corso...', complete: 'Analisi completata', promptInstruction: 'Write all free-text fields in Italian.' } },
  }),
  fr: mergeLocale(enUi, {
    common: { language: 'Langue', loading: 'Chargement...', search: 'Rechercher', reset: 'Réinitialiser', unknown: 'inconnu', ended: 'Terminé', daysLeft: n => `${n} j restants`, hoursLeft: n => `${n} h restantes` },
    globalSearch: { placeholder: 'Rechercher des campagnes...', seeAll: q => `Voir tous les résultats pour « ${q} » →`, keepTyping: 'Continuez à saisir pour rechercher...', noMatches: 'Aucune campagne trouvée', trending: 'Tendances' },
    login: { verifyEmail: 'Vérifiez votre email', codeSent: email => `Nous avons envoyé un code à 6 chiffres à ${email}`, otpPlaceholder: 'Code à 6 chiffres', verifyAndSignIn: 'Vérifier et se connecter', back: '← Retour', passwordRule: 'Le mot de passe doit contenir au moins 8 caractères, avec lettres et chiffres.', otpNotice: 'Nous enverrons un code de vérification à votre email' },
    announcements: { recentUpdates: 'Nouveautés Kicksonar', featureUpdate: 'Mise à jour', maybeLater: 'Plus tard', explore: 'Explorer' },
    push: { favoritesNote: 'Favoris · digest quotidien', favoritesTitle: 'Vos projets suivis ont évolué', platformNote: 'Pouls plateforme · quotidien', platformTitle: 'Aujourd’hui sur Kickstarter', onboardingNote: 'Bienvenue sur Kicksonar', onboardingTitle: 'Commencez en une minute', pledgedToday: 'Collecté aujourd’hui', newBackers: 'Nouveaux contributeurs', liveFavorites: n => `${n} favoris en cours`, live: 'En cours', launched: 'Lancé', funded: 'Financé', pledged24h: 'Collecté 24h', backers24h: 'Contributeurs 24h', ending: 'Bientôt terminé', daysLeftShort: n => `${n} j restants`, sections: { fastestFunding: 'Plus fortes progressions', fastestBackers: 'Plus de nouveaux contributeurs', newlyLaunched: 'Nouveaux lancements', endingSoon: 'Bientôt terminés' }, maybeLater: 'Plus tard', explore: 'Explorer' },
    landing: { searchCampaigns: 'Rechercher des campagnes...', filter: 'Filtrer', project: 'Projet', category: 'Catégorie', pledged: 'Collecté', funded: 'Financé', monthlyTrend: 'Analyse mensuelle', launchesRate: 'Lancements mensuels et réussite', total: 'Total', rate: 'Taux', peak: 'Pic', brand: 'Marque', concept: 'Concept', market: 'Marché', prelaunch: 'Pré-lancement', risk: 'Risque', aiScore: 'Score de prédiction AI', overallScore: 'Score global / 100', likelySuccess: 'Succès probable', searchProjects: 'Rechercher des campagnes...', searchFor: q => `Rechercher « ${q} » →`, liveBadge: 'Données live · 200K+ campagnes', foundersSay: 'Ce que disent les fondateurs', foundersSub: 'Fondateurs et consultants qui utilisent Kicksonar', faq: 'Questions fréquentes', start: 'Commencer gratuitement', startSub: 'Inscription gratuite. Accès complet aux données. Sans carte bancaire.', createFree: 'Créer un compte gratuit', exploreData: 'Explorer les données', stateLabels: { live: 'En cours', successful: 'Réussi', failed: 'Échoué', canceled: 'Hors ligne', suspended: 'Hors ligne' } },
    favorites: { browse: 'Explorer les projets', projectName: 'Projet', status: 'Statut', category: 'Catégorie', pledged: 'Collecté', backers: 'Contributeurs', actions: 'Actions', expand: 'Déplier', collapse: 'Replier', subcategory: 'Sous-catégorie', country: 'Pays', goal: 'Objectif', funded: 'Financé', deadline: 'Date limite', projectId: 'ID projet' },
    projects: { endedAt: date => `Terminé · ${date}`, daysLeft: n => `${n} j restants`, hoursLeft: n => `${n} h restantes`, subcategory: 'Sous-catégorie', allSubcategories: 'Toutes les sous-catégories', agency: 'Agence', allAgencies: 'Toutes les agences', hasAgency: 'Avec agence', editView: 'Modifier la vue', visibleColumns: 'Colonnes visibles', selected: n => `${n} sélectionnés`, detectedAgency: 'Agence détectée', live: 'en cours', closing: 'Clôture' },
    analysis: { overview: 'Vue d’ensemble', timeAnalysis: 'Analyse temporelle', monthNames: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'], pledged: 'Collecté', projects: 'Projets', successRate: 'Taux de réussite', backers: 'Contributeurs', fullYear: 'Année complète', byMonth: 'Par mois', month: 'Mois', yearA: 'Année A', yearB: 'Année B', granularity: 'Granularité', dimension: 'Dimension', categoryOptional: 'Catégorie (optionnel)', allCategories: 'Toutes catégories', countryOptional: 'Pays (optionnel)', allCountries: 'Tous pays', comparisonTitle: (d, s) => `${d} · ${s}`, monthlyComparison: (d, a, b) => `Comparaison mensuelle ${d} (${a} vs ${b})` },
    predict: { dimensions: { brand: 'Crédibilité marque', concept: 'Clarté concept', market: 'Adéquation marché', prelaunch: 'Qualité pré-lancement', risk: 'Évaluation risque' }, api: { invalidUrl: 'Veuillez saisir une URL Kickstarter valide', fetching: 'Récupération de la page...', fetched: 'Page récupérée', analyzing: 'Analyse AI en cours...', complete: 'Analyse terminée', promptInstruction: 'Write all free-text fields in French.' } },
  }),
  es: mergeLocale(enUi, {
    common: { language: 'Idioma', loading: 'Cargando...', search: 'Buscar', reset: 'Restablecer', unknown: 'desconocido', ended: 'Finalizado', daysLeft: n => `${n} d restantes`, hoursLeft: n => `${n} h restantes` },
    globalSearch: { placeholder: 'Buscar campañas...', seeAll: q => `Ver todos los resultados para "${q}" →`, keepTyping: 'Sigue escribiendo para buscar...', noMatches: 'No hay campañas coincidentes', trending: 'Tendencias' },
    login: { verifyEmail: 'Verifica tu email', codeSent: email => `Enviamos un código de 6 dígitos a ${email}`, otpPlaceholder: 'Código de 6 dígitos', verifyAndSignIn: 'Verificar e iniciar sesión', back: '← Volver', passwordRule: 'La contraseña debe tener al menos 8 caracteres e incluir letras y números.', otpNotice: 'Enviaremos un código de verificación a tu email' },
    announcements: { recentUpdates: 'Novedades de Kicksonar', featureUpdate: 'Actualización', maybeLater: 'Más tarde', explore: 'Explorar' },
    push: { favoritesNote: 'Favoritos · resumen diario', favoritesTitle: 'Tus proyectos guardados se movieron', platformNote: 'Pulso de plataforma · diario', platformTitle: 'Hoy en Kickstarter', onboardingNote: 'Bienvenido a Kicksonar', onboardingTitle: 'Empieza en un minuto', pledgedToday: 'Recaudado hoy', newBackers: 'Nuevos patrocinadores', liveFavorites: n => `${n} favoritos en vivo`, live: 'En vivo', launched: 'Lanzado', funded: 'Financiado', pledged24h: 'Recaudado 24h', backers24h: 'Patrocinadores 24h', ending: 'Por terminar', daysLeftShort: n => `${n} d restantes`, sections: { fastestFunding: 'Mayores movimientos', fastestBackers: 'Más nuevos patrocinadores', newlyLaunched: 'Nuevos lanzamientos', endingSoon: 'Terminan pronto' }, maybeLater: 'Más tarde', explore: 'Explorar' },
    landing: { searchCampaigns: 'Buscar campañas...', filter: 'Filtrar', project: 'Proyecto', category: 'Categoría', pledged: 'Recaudado', funded: 'Financiado', monthlyTrend: 'Análisis mensual', launchesRate: 'Lanzamientos mensuales y éxito', total: 'Total', rate: 'Tasa', peak: 'Pico', brand: 'Marca', concept: 'Concepto', market: 'Mercado', prelaunch: 'Prelanzamiento', risk: 'Riesgo', aiScore: 'Score de predicción AI', overallScore: 'Score total / 100', likelySuccess: 'Probable éxito', searchProjects: 'Buscar campañas...', searchFor: q => `Buscar "${q}" →`, liveBadge: 'Datos en vivo · 200K+ campañas', foundersSay: 'Lo que dicen los fundadores', foundersSub: 'Fundadores y consultores que usan Kicksonar', faq: 'Preguntas frecuentes', start: 'Empieza gratis', startSub: 'Registro gratis. Acceso completo a datos. Sin tarjeta.', createFree: 'Crear cuenta gratis', exploreData: 'Explorar datos', stateLabels: { live: 'En vivo', successful: 'Exitoso', failed: 'Fallido', canceled: 'Sin conexión', suspended: 'Sin conexión' } },
    favorites: { browse: 'Explorar proyectos', projectName: 'Proyecto', status: 'Estado', category: 'Categoría', pledged: 'Recaudado', backers: 'Patrocinadores', actions: 'Acciones', expand: 'Expandir', collapse: 'Contraer', subcategory: 'Subcategoría', country: 'País', goal: 'Meta', funded: 'Financiado', deadline: 'Fecha límite', projectId: 'ID proyecto' },
    projects: { endedAt: date => `Finalizado · ${date}`, daysLeft: n => `${n} d restantes`, hoursLeft: n => `${n} h restantes`, subcategory: 'Subcategoría', allSubcategories: 'Todas las subcategorías', agency: 'Agencia', allAgencies: 'Todas las agencias', hasAgency: 'Con agencia', editView: 'Editar vista', visibleColumns: 'Columnas visibles', selected: n => `${n} seleccionados`, detectedAgency: 'Agencia detectada', live: 'en vivo', closing: 'Cierre' },
    analysis: { overview: 'Resumen', timeAnalysis: 'Análisis temporal', monthNames: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'], pledged: 'Recaudado', projects: 'Proyectos', successRate: 'Tasa de éxito', backers: 'Patrocinadores', fullYear: 'Año completo', byMonth: 'Por mes', month: 'Mes', yearA: 'Año A', yearB: 'Año B', granularity: 'Granularidad', dimension: 'Dimensión', categoryOptional: 'Categoría (opcional)', allCategories: 'Todas las categorías', countryOptional: 'País (opcional)', allCountries: 'Todos los países', comparisonTitle: (d, s) => `${d} · ${s}`, monthlyComparison: (d, a, b) => `Comparación mensual ${d} (${a} vs ${b})` },
    predict: { dimensions: { brand: 'Credibilidad de marca', concept: 'Claridad del concepto', market: 'Ajuste de mercado', prelaunch: 'Calidad de prelanzamiento', risk: 'Evaluación de riesgo' }, api: { invalidUrl: 'Introduce una URL válida de Kickstarter', fetching: 'Obteniendo contenido...', fetched: 'Contenido obtenido', analyzing: 'AI analizando...', complete: 'Análisis completo', promptInstruction: 'Write all free-text fields in Spanish.' } },
  }),
};
