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
        // 公交路线规划，确保添加城市参数
        url = `https://restapi.amap.com/v3/direction/transit/integrated?origin=${origin}&destination=${destination}&city=010&key=${amapKey}`;
    } else if (mode === 'driving') {
        // 驾车路线规划
        url = `https://restapi.amap.com/v3/direction/driving?origin=${origin}&destination=${destination}&key=${amapKey}`;
    } else if (mode === 'walking') {
        // 步行路线规划
        url = `https://restapi.amap.com/v3/direction/walking?origin=${origin}&destination=${destination}&key=${amapKey}`;
    } else if (mode === 'bicycling') {
        // 骑行路线规划，使用 V4 版本
        url = `https://restapi.amap.com/v4/direction/bicycling?origin=${origin}&destination=${destination}&key=${amapKey}`;
    } else {
        return res.status(400).json({ status: "0", info: "无效的出行方式" });
    }

    try {
        const response = await axios.get(url);
        const data = response.data;

        // 检查 API 返回状态
        if (data.status === '0') {
            return res.status(400).json({ status: "0", info: data.info });
        }

        // 处理返回数据
        let distance = 0;
        let duration = 0;
        let cost = 0;

        if (mode === 'driving') {
            distance = parseFloat(data.route.paths[0].distance);
            duration = parseFloat(data.route.paths[0].duration);
            cost = parseFloat(data.route.tolls) || 0;
        } else if (mode === 'transit') {
            distance = parseFloat(data.route.transits[0].distance);
            duration = parseFloat(data.route.transits[0].duration);
            cost = parseFloat(data.route.cost) || 0;
        } else if (mode === 'walking' || mode === 'bicycling') {
            distance = parseFloat(data.route.paths[0].distance);
            duration = parseFloat(data.route.paths[0].duration);
        }

        // 转换单位
        const distanceInKm = (distance / 1000).toFixed(2);
        const durationInMinutes = (duration / 60).toFixed(2);

        res.json({
            duration: durationInMinutes,
            distance: distanceInKm,
            cost: cost
        });
    } catch (error) {
        console.error("请求错误:", error);
        res.status(500).json({ status: "0", info: "请求失败" });
    }
});

app.listen(port, () => {
    console.log(`服务器正在运行在 http://localhost:${port}`);
});
