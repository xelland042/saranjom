from fastapi import FastAPI
from contextlib import asynccontextmanager

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

from app.core.config import settings

if settings.tracing.enabled:
    resource = Resource.create(
        attributes={"service.name": settings.tracing.service_name}
    )
    tracer_provider = TracerProvider(resource=resource)
    otlp_exporter = OTLPSpanExporter(
        endpoint=settings.tracing.otlp_endpoint, insecure=True
    )
    tracer_provider.add_span_processor(BatchSpanProcessor(otlp_exporter))
    if settings.tracing.console:
        tracer_provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    trace.set_tracer_provider(tracer_provider)
    SQLAlchemyInstrumentor().instrument(
        tracer_provider=tracer_provider,
        enable_commenter=True,
    )

from app.core.database import db_helper
from app.core.errors import add_error_handlers
from app.api import router as main_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # starting
    yield
    # finishing
    await db_helper.dispose()


main_app = FastAPI(
    lifespan=lifespan,
    debug=settings.debug,
)

if settings.tracing.enabled:
    FastAPIInstrumentor.instrument_app(main_app, tracer_provider=tracer_provider)

add_error_handlers(main_app)
main_app.include_router(main_router)
