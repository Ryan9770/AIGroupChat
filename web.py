from duckduckgo_search import DDGS                                                                                                                                           
                                                                                                                                                                                
def search(keyword, max_results=5):                                                                                                                                          
    results = []                                                                                                                                                             
    with DDGS() as ddgs:                                                                                                                                                     
        for r in ddgs.text(keyword, region="kr-kr", max_results=max_results):                                                                                                
            results.append({                                                                                                                                                 
                "title": r["title"],                                                                                                                                         
                "link": r["href"],                                                                                                                                           
                "snippet": r["body"]                                                                                                                                         
            })                                                                                                                                                               
    return results                                                                                                                                                           
                                                                                                                                                                                
if __name__ == "__main__":                                                                                                                                                   
    keyword = "파이썬"                                                                                                                                                       
    print(f"[{keyword}] 검색 중...\n")                                                                                                                                       
                                                                                                                                                                                
    items = search(keyword, max_results=5)                                                                                                                                   
    for idx, item in enumerate(items, 1):                                                                                                                                    
        print(f"{idx}. {item['title']}")                                                                                                                                     
        print(f"   URL: {item['link']}")                                                                                                                                     
        print(f"   요약: {item['snippet']}\n") 