const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

// 允许跨域请求
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// 定义私家车成本常量
const DRIVING_COST_CONSTANTS = {
    FUEL_PRICE: 7.79,  // 当前汽油价格（元/升）
    FUEL_CONSUMPTION: 8.0,  // 百公里油耗（升/100公里）
    DEPRECIATION_PER_KM: 0.5,  // 每公里折旧成本（元/公里）
};

app.get('/api/route', async (req, res) => {
    const { origin, destination, mode } = req.query;
    const amapKey = process.env.AMAP_API_KEY;

    if (!origin || !destination || !mode) {
        return res.status(400).json({
            status: "0",
            info: "缺少必要参数",
            type: mode || "unknown",
            route_info: {}
        });
    }

    try {
        let url;
        if (mode === 'transit') {
            url = `https://restapi.amap.com/v3/direction/transit/integrated?origin=${origin}&destination=${destination}&city=0755&extensions=all&key=${amapKey}`;
        } else if (mode === 'driving') {
            url = `https://restapi.amap.com/v3/direction/driving?origin=${origin}&destination=${destination}&extensions=all&key=${amapKey}`;
        } else if (mode === 'walking') {
            url = `https://restapi.amap.com/v3/direction/walking?origin=${origin}&destination=${destination}&key=${amapKey}`;
        } else if (mode === 'bicycling') {
            url = `https://restapi.amap.com/v3/direction/riding?origin=${origin}&destination=${destination}&key=${amapKey}`;
        } else {
            return res.status(400).json({
                status: "0",
                info: "无效的出行方式",
                type: mode,
                route_info: {}
            });
        }

        const response = await axios.get(url);
        console.log('API Response:', JSON.stringify(response.data, null, 2)); // 添加日志

        const result = {
            status: response.data.status,
            info: response.data.info,
            type: mode,
            route_info: {}
        };

        if (response.data.status === '1') {
            if (mode === 'bicycling') {
                // 处理骑行路线数据
                const paths = response.data.route.paths;
                if (paths && paths.length > 0) {
                    const path = paths[0];
                    const distanceInKm = parseInt(path.distance) / 1000;
                    
                    result.route_info = {
                        duration: {
                            value: parseInt(path.duration),
                            text: `${Math.floor(path.duration / 60)}分钟`
                        },
                        distance: {
                            value: parseInt(path.distance),
                            text: `${distanceInKm.toFixed(2)}公里`
                        },
                        cost: {
                            calorie: parseFloat((distanceInKm * 40).toFixed(2)),
                            total: 0,
                            cost_detail: `消耗卡路里: ${(distanceInKm * 40).toFixed(2)}卡`
                        }
                    };

                    if (path.steps) {
                        result.route_info.steps = path.steps.map(step => ({
                            instruction: step.instruction || '',
                            orientation: step.orientation || '',
                            road_name: step.road || '',
                            distance: {
                                value: parseInt(step.distance) || 0,
                                text: `${((parseInt(step.distance) || 0) / 1000).toFixed(2)}公里`
                            },
                            duration: {
                                value: parseInt(step.duration) || 0,
                                text: `${Math.floor((parseInt(step.duration) || 0) / 60)}分钟`
                            }
                        }));
                    }
                }
            } else if (mode === 'driving') {
                // ... 驾车路线处理代码保持不变 ...
            } else if (mode === 'transit') {
                // ... 公交路线处理代码保持不变 ...
            } else if (mode === 'walking') {
                // ... 步行路线处理代码保持不变 ...
            }
        }

        res.json(result);
    } catch (error) {
        console.error("请求错误:", error);
        res.status(500).json({
            status: "0",
            info: error.message || "请求失败",
            type: mode,
            route_info: {}
        });
    }
});

app.listen(port, () => {
    console.log(`服务器正在运行在 http://localhost:${port}`);
});
