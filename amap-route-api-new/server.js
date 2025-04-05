   const express = require('express');
   const axios = require('axios');
   const app = express();
   const port = process.env.PORT || 3000;

   app.get('/api/route', async (req, res) => {
     const { origin, destination, mode } = req.query;
     const amapKey = process.env.AMAP_API_KEY; // 使用环境变量

     const url = `https://restapi.amap.com/v5/direction/${mode}?origin=${origin}&destination=${destination}&key=${amapKey}`;

     try {
       const response = await axios.get(url);
       res.json(response.data);
     } catch (error) {
       console.error("请求错误:", error);
       res.status(500).json({ status: "0", info: "请求失败" });
     }
   });

   app.listen(port, () => {
     console.log(`服务器正在运行在 http://localhost:${port}`);
   });