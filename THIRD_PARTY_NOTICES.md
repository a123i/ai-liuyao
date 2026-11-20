# 第三方资料

| 组件 | 使用范围 | 来源与许可 |
| --- | --- | --- |
| lunar-javascript 1.7.7 | 浏览器和服务端排盘所需的历法计算 | [上游仓库](https://github.com/6tail/lunar-javascript) · [随附 MIT 许可证](public/vendor/lunar-javascript.LICENSE) |
| yijing-data | 64 卦的卦名、卦辞和 384 条爻辞 | [所用版本](https://github.com/qingshano/yijing-data/tree/85479622197efde01d98199ded59a91871e12660) · [随附 MIT 许可证](licenses/yijing-data-MIT.txt) |

开源发行版从 yijing-data 的 `data/hexagrams` 中提取文本，以从初爻至上爻的六位阴阳序列作键。爻辞只取经文部分，省去《象》传；乾坤另列通行古经的用九、用六。输出位于 `public/iching-data.js`。应用代码的 MIT 授权与各第三方组件的许可分别保留。
