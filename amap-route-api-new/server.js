const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

app.get('/api/route', async (req, res) => {
    const { origin, destination, mode } = req.query;
    const amapKey = process.env.AMAP_API_KEY; // 使用环境变量

    // 根据不同的出行方式构建 URL
    let url;
    let showFields = 'duration,distance'; // 默认返回时长和距离

    if (mode === 'transit') {
        // 公交路线规划，城市编码设置为0755（深圳）
        url = `https://restapi.amap.com/v5/direction/transit/integrated?origin=${origin}&destination=${destination}&key=${amapKey}&city1=0755&city2=0755&show_fields=transit_fee,duration,distance`;
    } else if (mode === 'driving') {
        // 驾车路线规划
        showFields += ',tolls'; // 添加收费字段
        url = `https://restapi.amap.com/v5/direction/${mode}?origin=${origin}&destination=${destination}&key=${amapKey}&show_fields=${showFields}`;
    } else {
        // 其他出行方式
        url = `https://restapi.amap.com/v5/direction/${mode}?origin=${origin}&destination=${destination}&key=${amapKey}&show_fields=${showFields}`;
    }

    try {
        const response = await axios.get(url);
        const data = response.data;

        // 计算金钱成本
        let cost = 0;
        if (mode === 'driving') {
            const distance = data.route.paths[0].distance; // 获取出行距离
            const tolls = data.route.tolls || 0; // 获取收费
            const costPerKm = 1; // 假设每公里的成本（可以根据实际情况调整）
            cost = (distance / 1000) * costPerKm + tolls; // 计算总成本
        } else if (mode === 'transit') {
            cost = data.route.transit_fee; // 公交费用
        } else {
            const distance = data.route.paths[0].distance; // 获取出行距离
            const costPerKm = 0.5; // 假设每公里的成本（可以根据实际情况调整）
            cost = (distance / 1000) * costPerKm; // 计算总成本
        }

        res.json({
            duration: data.route.paths[0].duration, // 出行时长
            distance: data.route.paths[0].distance, // 出行距离
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
