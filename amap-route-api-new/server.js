const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

// 定义私家车成本常量
const DRIVING_COST_CONSTANTS = {
    FUEL_PRICE: 7.79,  // 假设当前汽油价格（元/升）
    FUEL_CONSUMPTION: 8.0,  // 假设百公里油耗（升/100公里）
    DEPRECIATION_PER_KM: 0.5,  // 假设每公里折旧成本（元/公里）
};

app.get('/api/route', async (req, res) => {
    const { origin, destination, mode } = req.query;
    const amapKey = process.env.AMAP_API_KEY;

    // 根据不同的出行方式构建 URL
    let url;
    if (mode === 'transit') {
        // 深圳市的城市编码是0755
        url = `https://restapi.amap.com/v3/direction/transit/integrated?origin=${origin}&destination=${destination}&city=0755&extensions=all&key=${amapKey}`;
    } else if (mode === 'driving') {
        url = `https://restapi.amap.com/v3/direction/driving?origin=${origin}&destination=${destination}&key=${amapKey}`;
    } else if (mode === 'walking') {
        url = `https://restapi.amap.com/v3/direction/walking?origin=${origin}&destination=${destination}&key=${amapKey}`;
    } else if (mode === 'bicycling') {
        // 注意：骑行API使用的是v5版本
        url = `https://restapi.amap.com/v5/direction/riding?origin=${origin}&destination=${destination}&key=${amapKey}`;
    } else {
        return res.status(400).json({ status: "0", info: "无效的出行方式" });
    }

    try {
        const response = await axios.get(url);
        
        // 处理API响应数据
        const result = {
            status: response.data.status || response.data.errcode === "0", // 骑行API使用errcode
            info: response.data.info || response.data.errmsg || "OK",
            type: mode,
            route_info: {}
        };

        if (result.status) {
            if (mode === 'bicycling') {
                // 处理骑行路线数据
                const path = response.data.route;
                if (!path) {
                    throw new Error('No route data available');
                }

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
                        calorie: parseFloat((distanceInKm * 40).toFixed(2)), // 假设每公里消耗40卡路里
                        total: 0,
                        cost_detail: `消耗卡路里: ${(distanceInKm * 40).toFixed(2)}卡`
                    }
                };

                // 如果有详细的路径信息，添加到返回结果中
                if (path.steps && Array.isArray(path.steps)) {
                    result.route_info.steps = path.steps.map(step => ({
                        instruction: step.instruction,
                        road_name: step.road_name || '',
                        distance: {
                            value: parseInt(step.distance),
                            text: `${(parseInt(step.distance) / 1000).toFixed(2)}公里`
                        },
                        duration: {
                            value: parseInt(step.duration),
                            text: `${Math.floor(parseInt(step.duration) / 60)}分钟`
                        },
                        orientation: step.orientation || '',
                        action: step.action || ''
                    }));
                }
            }
            // ... 其他模式的代码保持不变 ...
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
