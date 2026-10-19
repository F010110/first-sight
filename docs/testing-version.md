# 测试说明

当前正式版为[v1.2.0](releases/v1.2.0.md)。旧test.5说明已[归档](archive/testing-version-1.1.md)。

```powershell
npm run typecheck
npm test
python -m unittest discover -s tests/python -t .
python scripts/check-doc-links.py
```

Python测试需`requirements.txt`及`sim/school/requirements-activity-review.txt`；执行前`npm run build`提供HTTP测试所需服务。可使用`.venv/Scripts/python.exe`代替`python`。

`npm test`只运行当前构建中的`.test.js`，不会扫描冻结旧编译目录，也不会发起付费90题评测。真实模型、模拟器GPU、桌面浏览器、外部数据依赖的验收必须单独记录。
