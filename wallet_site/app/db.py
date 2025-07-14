from sqlmodel import create_engine, Session

# 放在项目根目录 wallet_site/wallet_jobs.db
engine = create_engine("sqlite:///wallet_jobs.db", echo=True)

def get_session():
    return Session(engine)
