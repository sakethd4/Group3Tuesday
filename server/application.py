"""AWS Elastic Beanstalk WSGI entry point (deploy server/ as the root)."""
if __package__:
    from .app import app as application
else:
    from app import app as application
