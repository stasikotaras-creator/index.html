
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>REVEL TradeGuard</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0c1420;color:#edf2f8;font-family:Arial,sans-serif}
main{max-width:650px;margin:auto;padding:20px}
header{display:flex;justify-content:space-between;align-items:center}
h1{font-size:22px;color:#e8c27a}
small,.muted{color:#a4b2c4}
.card{background:#192637;border-radius:14px;padding:18px;margin:14px 0}
.value{font-size:36px;font-weight:bold;margin:12px 0}
.green{color:#5bd6a1}
.red{color:#ff8585}
button{background:#e8c27a;color:#101824;border:0;border-radius:9px;padding:12px 18px;font-weight:bold}
button:disabled{opacity:.35}
.controls{display:flex;justify-content:space-between;align-items:center}
.stock{display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid #344153}
svg{width:100%;height:auto}
footer{font-size:12px;color:#a4b2c4;line-height:1.5;margin-top:25px}
</style>
</head>
<body>
<main>
<header>
<h1>REVEL / TRADEGUARD</h1>
<small>DEMO</small>
</header>
<div class="card">
<small>Virtual Portfolio Value</small>
<div class="value" id="value">A$5,000.00</div>
<div id="profit" class="green">A$0.00 (0.00%)</div>
</div>
<div class="card">
<strong>Portfolio Performance</strong>
<svg id="chart" viewBox="0 0 340 150"></svg>
<div class="controls">
<button onclick="change(-1)">Previous</button>
<span id="day">Day 0 / 7</span>
<button onclick="change(1)">Next Day</button>
</div>
</div>
<div class="card">
<strong>Portfolio Allocation</strong>
<div id="stocks"></div>
</div>
<button onclick="reset()">Reset Simulation</button>
<footer>
Paper trading only. Illustrative prices and returns,
not live market data. No real trades are executed.
</footer>
</main>
<script>
const values=[5000,5032,4991,5068,5054,5110,5082,5144];
const stocks=[
["RTX",25],["GD",20],["LMT",20],
["BAE Systems",20],["NOC",15]
];
let day=0;
function render(){
const v=values[day],p=v-5000;
document.getElementById("value").textContent=
"A$"+v.toLocaleString("en-AU",{minimumFractionDigits:2});
const el=document.getElementById("profit");
el.textContent=(p>=0?"+":"-")+"A$"+Math.abs(p).toFixed(2)+
" ("+(p/5000*100).toFixed(2)+"%)";
el.className=p>=0?"green":"red";
document.getElementById("day").textContent="Day "+day+" / 7";
document.getElementById("stocks").innerHTML=stocks.map(s=>
'<div class="stock"><span>'+s[0]+'</span><span>'+
s[1]+'% · A$'+(v*s[1]/100).toFixed(2)+'</span></div>'
).join("");
let pts=values.slice(0,day+1).map((n,i)=>
(i*45+12)+","+(130-(n-4900)*.35)).join(" ");
document.getElementById("chart").innerHTML=
'<line x1="0" y1="130" x2="340" y2="130" stroke="#42516a"/>'+
'<polyline points="'+pts+'" fill="none" stroke="#e8c27a" stroke-width="3"/>';
}
function change(n){day=Math.max(0,Math.min(7,day+n));render()}
function reset(){day=0;render()}
render();
</script>
</body>
</html>
