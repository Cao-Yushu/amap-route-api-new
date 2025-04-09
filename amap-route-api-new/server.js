const express = require('express');
const axios = require('axios');
const app = express();
const port = process.env.PORT || 3000;

app.get('/api/route', async (req, res) => {
    const { origin, destination, mode } = req.query;
    const amapKey = process.env.AMAP_API_KEY;

    // 根据不同的出行方式构建 URL
    let url;
    if (mode === 'transit') {
        url = `https://restapi.amap.com/v3/direction/transit/integrated?origin=${origin}&destination=${destination}&city=0755&key=${amapKey}`;
    } else if (mode === 'driving') {
        url = `https://restapi.amap.com/v3/direction/driving?origin=${origin}&destination=${destination}&key=${amapKey}`;
    } else if (mode === 'walking') {
        url = `https://restapi.amap.com/v3/direction/walking?origin=${origin}&destination=${destination}&key=${amapKey}`;
    } else if (mode === 'bicycling') {
        url = `https://restapi.amap.com/v4/direction/bicycling?origin=${origin}&destination=${destination}&key=${amapKey}`;
    } else {
        return res.status(400).json({ status: "0", info: "无效的出行方式" });
    }

    try {
        const response = await axios.get(url);
        
        // 处理API响应数据
        const result = {
            status: response.data.status,
            info: response.data.info,
            type: mode,
            route_info: {}
        };

        if (response.data.status === '1') {
            if (mode === 'driving') {
                const path = response.data.route.paths[0];
                result.route_info = {
                    duration: {
                        value: parseInt(path.duration),
                        text: `${Math.floor(path.duration / 60)}分${path.duration % 60}秒`
                    },
                    distance: {
                        value: parseInt(path.distance),
                        text: path.distance > 1000 ? `${(path.distance / 1000).toFixed(1)}公里` : `${path.distance}米`
                    },
                    cost: {
                        taxi: parseFloat(response.data.route.taxi_cost || 0),
                        toll: parseFloat(path.tolls || 0),
                        total: parseFloat(response.data.route.taxi_cost || 0) + parseFloat(path.tolls || 0)
                    }
                };
            }
            // TODO: 其他出行方式的数据处理将在后续添加
        }

        res.json(result);
    } catch (error) {
        console.error("请求错误:", error);
        res.status(500).json({ status: "0", info: "请求失败" });
    }
});

app.listen(port, () => {
    console.log(`服务器正在运行在 http://localhost:${port}`);
});
