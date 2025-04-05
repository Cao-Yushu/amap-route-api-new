const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

app.get('/api/route', async (req, res) => {
    const { origin, destination, mode } = req.query;
    const amapKey = process.env.AMAP_API_KEY; // 使用环境变量

    // 根据不同的出行方式构建 URL
    let url;
    if (mode === 'transit') {
        // 公交路线规划，城市编码设置为0755（深圳）
        url = `https://restapi.amap.com/v5/direction/transit/integrated?origin=${origin}&destination=${destination}&key=${amapKey}&city1=0755&city2=0755&show_fields=transit_fee,duration,distance`;
    } else if (mode === 'driving') {
        // 驾车路线规划
        url = `https://restapi.amap.com/v5/direction/${mode}?origin=${origin}&destination=${destination}&key=${amapKey}&show_fields=duration,distance,tolls`;
    } else if (mode === 'walking') {
        // 步行路线规划
        url = `https://restapi.amap.com/v5/direction/${mode}?origin=${origin}&destination=${destination}&key=${amapKey}&show_fields=duration,distance`;
    } else {
        // 其他出行方式
        url = `https://restapi.amap.com/v5/direction/${mode}?origin=${origin}&destination=${destination}&key=${amapKey}`;
    }

    try {
        const response = await axios.get(url);
        const data = response.data;

        // 检查 API 返回状态
        if (data.status === '0') {
            return res.status(400).json({ status: "0", info: data.info });
        }

        // 计算金钱成本
        let cost = 0;
        let distance = 0;
        let duration = 0;

        if (mode === 'driving') {
            distance = data.route.paths[0].distance; // 获取出行距离（米）
            const tolls = data.route.tolls || 0; // 获取收费
            const costPerKm = 1; // 假设每公里的成本（可以根据实际情况调整）
            cost = (distance / 1000) * costPerKm + tolls; // 计算总成本
            duration = data.route.paths[0].duration; // 获取出行时长（秒）
        } else if (mode === 'transit') {
            cost = data.route.transit_fee; // 公交费用
            distance = data.route.transits[0].distance; // 获取出行距离（米）
            duration = data.route.transits[0].duration; // 获取出行时长（秒）
        } else if (mode === 'walking') {
            distance = data.route.paths[0].distance; // 获取出行距离（米）
            duration = data.route.paths[0].duration; // 获取出行时长（秒）
        } else {
            distance = data.route.paths[0].distance; // 获取出行距离（米）
            duration = data.route.paths[0].duration; // 获取出行时长（秒）
        }

        // 转换单位
        const distanceInKm = (distance / 1000).toFixed(2); // 转换为公里
        const durationInMinutes = (duration / 60).toFixed(2); // 转换为分钟

        res.json({
            duration: durationInMinutes, // 出行时长（分钟）
            distance: distanceInKm, // 出行距离（公里）
            cost: cost // 金钱成本
        });
    } catch (error) {
        console.error("请求错误:", error);
        res.status(500).json({ status: "0", info: "请求失败" });
    }
});

app.listen(port, () => {
    console.log(`服务器正在运行在 http://localhost:${port}`);
});
