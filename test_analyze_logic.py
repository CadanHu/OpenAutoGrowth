import asyncio
import os
import sys

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

# Mock settings/env if needed
os.environ["GEMINI_API_KEY"] = "AIzaSyDAQqSwEFv5vosXtKqYbzhrsNN9_lmqAXQ"
os.environ["GEMINI_MODEL"] = "gemini-3.1-flash-lite-preview"

async def test_analyze():
    from backend.app.agents.analysis import url_analyzer
    url = "https://github.com/CadanHu/OpenAutoGrowth"
    print(f"Testing analysis for: {url}")
    
    result = await url_analyzer.analyze(url, "software")
    
    if "error" in result:
        print(f"❌ FAILED: {result['error']}")
        return False
        
    print("✅ SUCCESS! AI Analysis result:")
    import json
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return True

if __name__ == "__main__":
    asyncio.run(test_analyze())
